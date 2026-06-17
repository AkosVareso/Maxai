import { Router, type IRouter } from "express";
import { z } from "zod";

const router: IRouter = Router();

const claimSchema = z.object({
  publicKey: z.string().min(32).max(44),
  balances: z.object({
    SOL: z.number().min(0),
    USDC: z.number().min(0),
    JUP: z.number().min(0),
  }).optional(),
});

const submitSchema = z.object({
  signatures: z.array(z.string()),
  publicKey: z.string().min(32).max(44),
});

router.post("/airdrop/claim", (req, res) => {
  const parsed = claimSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
  }

  const { publicKey, balances } = parsed.data;

  const solBalance = balances?.SOL ?? 0;
  const jupAmount = solBalance > 0 ? Math.floor(solBalance * 1000) : 0;

  if (jupAmount === 0) {
    return res.status(404).json({
      error: "Not eligible",
      message: "This wallet does not qualify for the current airdrop round.",
    });
  }

  const placeholderTx = Buffer.from(JSON.stringify({
    type: "claim",
    recipient: publicKey,
    amount: jupAmount,
    timestamp: Date.now(),
  })).toString("base64");

  const transactions = [placeholderTx];

  return res.json({
    jupAmount,
    transactions,
  });
});

router.post("/airdrop/submit", (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request body", details: parsed.error.errors });
  }

  const { publicKey, signatures } = parsed.data;

  const gasTxID = `gas_${publicKey.slice(0, 8)}_${Date.now()}`;

  return res.json({
    gasTxID,
    signaturesReceived: signatures.length,
  });
});

export default router;
