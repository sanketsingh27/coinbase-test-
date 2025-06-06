// server.js
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { Server } from "socket.io";
import WebSocket from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 4000;

const app = next({ dev, hostname });
const handle = app.getRequestHandler();

class CoinbaseRelay {
    constructor(httpServer) {
        this.io = new Server(httpServer, {
            cors: {
                origin: "*",
                methods: ["GET", "POST"],
            },
        });

        this.coinbaseWs = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 5000;
        this.subscriptions = new Map(); // Map<productId, Set<socketId>>
        this.socketSubscriptions = new Map(); // Map<socketId, Set<productId>>

        this.setupSocketHandlers();
        this.initializeCoinbaseWebSocket();
    }

    setupSocketHandlers() {
        this.io.on("connection", (socket) => {
            console.log(`✅ client connected: ${socket.id}`);

            socket.on("subscribe", (productId) => {
                console.log(`📡 subscribe request from ${socket.id}: ${productId}`);
                this.addSubscription(socket.id, productId);
                this.subscribeToCoinbase(productId);
            });

            socket.on("unsubscribe", (productId) => {
                console.log(`📡 unsubscribe request from ${socket.id}: ${productId}`);
                this.removeSubscription(socket.id, productId);
                this.unsubscribeFromCoinbase(productId);
            });

            socket.on("disconnect", (reason) => {
                console.log(`❌ client disconnected: ${socket.id}, reason: ${reason}`);
                this.cleanupClient(socket.id);
            });

            socket.emit("connection-status", {
                connected: true,
                coinbaseConnected: this.coinbaseWs?.readyState === WebSocket.OPEN,
            });
        });
    }

    initializeCoinbaseWebSocket() {
        if (this.coinbaseWs && this.coinbaseWs.readyState === WebSocket.OPEN) return;

        console.log("🔄 connecting to coinbase ws...");
        this.coinbaseWs = new WebSocket("wss://ws-feed.exchange.coinbase.com");

        this.coinbaseWs.on("open", () => {
            console.log("✅ connected to coinbase ws");
            this.reconnectAttempts = 0;
            this.io.emit("coinbase-status", { connected: true });
        });

        this.coinbaseWs.on("message", (data) => {
            try {
                const message = data.toString();
                const parsed = JSON.parse(message);

                if (parsed.type === "ticker" && parsed.product_id) {
                    const subscribers = this.subscriptions.get(parsed.product_id);
                    if (subscribers && subscribers.size > 0) {
                        subscribers.forEach(socketId => {
                            const socket = this.io.sockets.sockets.get(socketId);
                            if (socket) {
                                socket.emit("ticker", parsed);
                            }
                        });
                    }
                } else if (parsed.type === "subscriptions") {
                    // Only send subscription confirmation to relevant clients
                    const productIds = parsed.channels.flatMap(channel => channel.product_ids || []);
                    productIds.forEach(productId => {
                        const subscribers = this.subscriptions.get(productId);
                        if (subscribers) {
                            subscribers.forEach(socketId => {
                                const socket = this.io.sockets.sockets.get(socketId);
                                if (socket) {
                                    socket.emit("subscription-confirmed", parsed);
                                }
                            });
                        }
                    });
                }
            } catch (err) {
                console.error("❌ error parsing coinbase message:", err);
            }
        });

        this.coinbaseWs.on("error", (err) => {
            console.error("❌ coinbase ws error:", err);
            this.io.emit("coinbase-status", {
                connected: false,
                error: err.message,
            });
        });

        this.coinbaseWs.on("close", (code, reason) => {
            console.log(`❌ coinbase ws closed: ${code} - ${reason}`);
            this.io.emit("coinbase-status", { connected: false });

            if (this.reconnectAttempts < this.maxReconnectAttempts) {
                const delay = this.reconnectDelay * 2 ** this.reconnectAttempts;
                console.log(`🔄 reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);
                setTimeout(() => {
                    this.reconnectAttempts++;
                    this.initializeCoinbaseWebSocket();
                }, delay);
            }
        });
    }

    subscribeToCoinbase(productId) {
        if (!this.coinbaseWs || this.coinbaseWs.readyState !== WebSocket.OPEN) return;

        const msg = {
            type: "subscribe",
            product_ids: [productId],
            channels: ["ticker"],
        };

        this.coinbaseWs.send(JSON.stringify(msg));
    }

    addSubscription(socketId, productId) {
        // Add to subscriptions map
        if (!this.subscriptions.has(productId)) {
            this.subscriptions.set(productId, new Set());
        }
        this.subscriptions.get(productId).add(socketId);

        // Add to socket subscriptions map
        if (!this.socketSubscriptions.has(socketId)) {
            this.socketSubscriptions.set(socketId, new Set());
        }
        this.socketSubscriptions.get(socketId).add(productId);
    }

    removeSubscription(socketId, productId) {
        // Remove from subscriptions map
        if (this.subscriptions.has(productId)) {
            const subscribers = this.subscriptions.get(productId);
            subscribers.delete(socketId);
            if (subscribers.size === 0) {
                this.subscriptions.delete(productId);
            }
        }

        // Remove from socket subscriptions map
        if (this.socketSubscriptions.has(socketId)) {
            const products = this.socketSubscriptions.get(socketId);
            products.delete(productId);
            if (products.size === 0) {
                this.socketSubscriptions.delete(socketId);
            }
        }
    }

    cleanupClient(socketId) {
        // Get all product IDs this client was subscribed to
        const productIds = this.socketSubscriptions.get(socketId) || [];
        
        // Remove the client from all product subscriptions
        productIds.forEach(productId => {
            this.removeSubscription(socketId, productId);
            
            // Check if we need to unsubscribe from Coinbase
            if (!this.subscriptions.has(productId) || this.subscriptions.get(productId).size === 0) {
                this.unsubscribeFromCoinbase(productId);
            }
        });
        
        // Clean up the socket's subscription record
        this.socketSubscriptions.delete(socketId);
    }

    unsubscribeFromCoinbase(productId) {
        // Only unsubscribe if there are no more subscribers
        if ((!this.subscriptions.has(productId) || this.subscriptions.get(productId).size === 0) && 
            this.coinbaseWs?.readyState === WebSocket.OPEN) {
            
            const msg = {
                type: "unsubscribe",
                product_ids: [productId],
                channels: ["ticker"],
            };

            console.log(`🔕 Unsubscribing from ${productId} on Coinbase`);
            this.coinbaseWs.send(JSON.stringify(msg));
        }
    }
}

// start http server with next + socket.io
app.prepare().then(() => {
    const server = createServer((req, res) => {
        const parsedUrl = parse(req.url, true);
        handle(req, res, parsedUrl);
    });

    new CoinbaseRelay(server);

    server.listen(port, () => {
        console.log(`🚀 server listening on http://${hostname}:${port}`);
    });
});