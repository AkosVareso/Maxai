import { Router, type IRouter } from "express";
import healthRouter from "./health";
import airdropRouter from "./airdrop";

const router: IRouter = Router();

router.use(healthRouter);
router.use(airdropRouter);

export default router;
