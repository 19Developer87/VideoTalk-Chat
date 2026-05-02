import { Router, type IRouter } from "express";
import healthRouter from "./health";
import iceServersRouter from "./ice-servers";

const router: IRouter = Router();

router.use(healthRouter);
router.use(iceServersRouter);

export default router;
