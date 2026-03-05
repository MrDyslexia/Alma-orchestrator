import { Router } from 'express';
import healthRoutes from './routes/health.routes';
import statsRoutes from './routes/stats.routes';
import sessionsRoutes from './routes/sessions.routes';

const router = Router();

router.use('/health', healthRoutes);
router.use('/stats', statsRoutes);
router.use('/sessions', sessionsRoutes);

export default router;
