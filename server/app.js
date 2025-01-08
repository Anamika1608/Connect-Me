import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import http from 'http';
import initializeSocket from './src/socketConnection.js';
import { Server } from 'socket.io';
import dotenv from "dotenv"
dotenv.config({
    path: "./.env"
})
import mediaSoupSocketConnection from './src/mediasoupConnection.js'

const app = express();
const server = http.createServer(app);

const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

initializeSocket(io)

const connections = io.of("/mediasoup");
mediaSoupSocketConnection(connections);

app.use(cors({
    origin: process.env.CORS_ORIGIN || "*",
    credentials: true
}));


app.use(express.json({ limit: "16kb" }));
app.use(express.urlencoded({ limit: "16kb", extended: true }));
app.use(express.static("public"));
app.use(cookieParser());
app.get('/', (req, res) => {
    res.send("Server is up and running");
});

server.listen(process.env.PORT || 8000, () => {
    console.log(`App is listining on the ${process.env.PORT}`)
})

export { server, io } 
