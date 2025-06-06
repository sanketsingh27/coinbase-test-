import { createServer, Server as HttpServer } from "http";
import { parse } from "url";
import next from "next";
import { Server, Socket } from "socket.io";
import WebSocket from "ws";

const dev = process.env.NODE_ENV !== "production";
const hostname = "localhost";
const port = process.env.PORT || 4000;

interface CoinbaseMessage {
  type: string;
  product_id?: string;
  channels?: Array<{
    name: string;
    product_ids?: string[];
  }>;
  [key: string]: any;
}

interface ConnectionStatus {
  connected: boolean;
  error?: string;
  coinbaseConnected?: boolean;
}

class CoinbaseRelay {
  private io: Server;
  private coinbaseWs: WebSocket | null = null;
  private reconnectAttempts: number = 0;
  private readonly maxReconnectAttempts: number = 5;
  private readonly reconnectDelay: number = 5000;
  private subscriptions: Map<string, Set<string>> = new Map(); // Map<productId, Set<socketId>>
  private socketSubscriptions: Map<string, Set<string>> = new Map(); // Map<socketId, Set<productId>>

  constructor(httpServer: HttpServer) {
    this.io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"],
      },
    });

    this.setupSocketHandlers();
    this.initializeCoinbaseWebSocket();
  }

  private setupSocketHandlers(): void {
    this.io.on("connection", (socket: Socket) => {
      console.log(`client connected: ${socket.id}`);

      socket.on("subscribe", (productId: string) => {
        console.log(` subscribe request from ${socket.id}: ${productId}`);
        this.addSubscription(socket.id, productId);
        this.subscribeToCoinbase(productId);
      });

      socket.on("unsubscribe", (productId: string) => {
        console.log(` unsubscribe request from ${socket.id}: ${productId}`);
        this.removeSubscription(socket.id, productId);
        this.unsubscribeFromCoinbase(productId);
      });

      socket.on("disconnect", (reason: string) => {
        console.log(`❌ client disconnected: ${socket.id}, reason: ${reason}`);
        this.cleanupClient(socket.id);
      });

      const status: ConnectionStatus = {
        connected: true,
        coinbaseConnected: this.coinbaseWs?.readyState === WebSocket.OPEN,
      };
      socket.emit("connection-status", status);
    });
  }

  private initializeCoinbaseWebSocket(): void {
    if (this.coinbaseWs?.readyState === WebSocket.OPEN) return;

    console.log("connecting to coinbase ws...");
    this.coinbaseWs = new WebSocket("wss://ws-feed.exchange.coinbase.com");

    this.coinbaseWs.on("open", () => {
      console.log("✅ connected to coinbase ws");
      this.reconnectAttempts = 0;
      this.io.emit("coinbase-status", { connected: true } as ConnectionStatus);
    });

    this.coinbaseWs.on("message", (data: WebSocket.Data) => {
      try {
        const message = data.toString();
        const parsed: CoinbaseMessage = JSON.parse(message);

        if (parsed.type === "ticker" && parsed.product_id) {
          this.handleTickerMessage(parsed);
        } else if (parsed.type === "subscriptions") {
          this.handleSubscriptionMessage(parsed);
        }
      } catch (err) {
        console.error(" error parsing coinbase message:", err);
      }
    });

    this.coinbaseWs.on("error", (err: Error) => {
      console.error(" coinbase ws error:", err);
      const status: ConnectionStatus = {
        connected: false,
        error: err.message,
      };
      this.io.emit("coinbase-status", status);
    });

    this.coinbaseWs.on("close", (code: number, reason: Buffer) => {
      console.log(`coinbase ws closed: ${code} - ${reason}`);
      this.io.emit("coinbase-status", { connected: false } as ConnectionStatus);

      if (this.reconnectAttempts < this.maxReconnectAttempts) {
        const delay = this.reconnectDelay * 2 ** this.reconnectAttempts;
        console.log(
          `reconnecting in ${delay}ms (attempt ${this.reconnectAttempts + 1})`
        );
        setTimeout(() => {
          this.reconnectAttempts++;
          this.initializeCoinbaseWebSocket();
        }, delay);
      }
    });
  }

  private handleTickerMessage(message: CoinbaseMessage): void {
    if (!message.product_id) return;

    const subscribers = this.subscriptions.get(message.product_id);
    if (subscribers?.size) {
      subscribers.forEach((socketId) => {
        const socket = this.io.sockets.sockets.get(socketId);
        socket?.emit("ticker", message);
      });
    }
  }

  private handleSubscriptionMessage(message: CoinbaseMessage): void {
    if (!message.channels) return;

    const productIds = message.channels.flatMap(
      (channel) => channel.product_ids || []
    );
    productIds.forEach((productId) => {
      const subscribers = this.subscriptions.get(productId);
      if (subscribers?.size) {
        subscribers.forEach((socketId) => {
          const socket = this.io.sockets.sockets.get(socketId);
          socket?.emit("subscription-confirmed", message);
        });
      }
    });
  }

  private subscribeToCoinbase(productId: string): void {
    if (!this.coinbaseWs || this.coinbaseWs.readyState !== WebSocket.OPEN)
      return;

    const msg = {
      type: "subscribe",
      product_ids: [productId],
      channels: ["ticker"],
    };

    this.coinbaseWs.send(JSON.stringify(msg));
  }

  private addSubscription(socketId: string, productId: string): void {
    // Add to subscriptions map
    if (!this.subscriptions.has(productId)) {
      this.subscriptions.set(productId, new Set());
    }
    this.subscriptions.get(productId)?.add(socketId);

    // Add to socket subscriptions map
    if (!this.socketSubscriptions.has(socketId)) {
      this.socketSubscriptions.set(socketId, new Set());
    }
    this.socketSubscriptions.get(socketId)?.add(productId);
  }

  private removeSubscription(socketId: string, productId: string): void {
    // Remove from subscriptions map
    if (this.subscriptions.has(productId)) {
      const subscribers = this.subscriptions.get(productId)!;
      subscribers.delete(socketId);
      if (subscribers.size === 0) {
        this.subscriptions.delete(productId);
      }
    }

    // Remove from socket subscriptions map
    if (this.socketSubscriptions.has(socketId)) {
      const products = this.socketSubscriptions.get(socketId)!;
      products.delete(productId);
      if (products.size === 0) {
        this.socketSubscriptions.delete(socketId);
      }
    }
  }

  private cleanupClient(socketId: string): void {
    const productIds = Array.from(this.socketSubscriptions.get(socketId) || []);

    // Remove the client from all product subscriptions
    productIds.forEach((productId) => {
      this.removeSubscription(socketId, productId);

      // Check if we need to unsubscribe from Coinbase
      const subscribers = this.subscriptions.get(productId);
      if (!subscribers || subscribers.size === 0) {
        this.unsubscribeFromCoinbase(productId);
      }
    });

    // Clean up the socket's subscription record
    this.socketSubscriptions.delete(socketId);
  }

  private unsubscribeFromCoinbase(productId: string): void {
    const hasNoSubscribers =
      !this.subscriptions.has(productId) ||
      this.subscriptions.get(productId)?.size === 0;

    if (hasNoSubscribers && this.coinbaseWs?.readyState === WebSocket.OPEN) {
      const msg = {
        type: "unsubscribe",
        product_ids: [productId],
        channels: ["ticker"],
      };

      console.log(`Unsubscribing from ${productId} on Coinbase`);
      this.coinbaseWs.send(JSON.stringify(msg));
    }
  }
}

// Start http server with next + socket.io
const app = next({ dev, hostname });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  const server = createServer((req, res) => {
    const parsedUrl = parse(req.url!, true);
    handle(req, res, parsedUrl);
  });

  new CoinbaseRelay(server);

  server.listen(port, () => {
    console.log(`🚀 server listening on http://${hostname}:${port}`);
  });
});
