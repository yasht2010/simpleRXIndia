import { createServer } from 'http';
import { Server } from 'socket.io';
import { app, sessionMiddleware } from './app.js';
import dotenv from 'dotenv';

dotenv.config();

const PORT = process.env.PORT || 3000;
const httpServer = createServer(app);
const io = new Server(httpServer);

// --- SOCKET.IO SETUP ---
import { setupSocket } from './socket/index.js';
// We need to move the massive socket block here or to a separate file.
// For now, I will keep the structure basic and we can migrate the logic in the next step.

const wrap = (middleware) => (socket, next) => middleware(socket.request, socket.request.res || {}, next);
io.use(wrap(sessionMiddleware));

setupSocket(io);

httpServer.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
