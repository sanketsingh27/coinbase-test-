export interface TickerData {
  type: string;
  sequence: number;
  product_id: string;
  price: string;
  open_24h: string;
  volume_24h: string;
  low_24h: string;
  high_24h: string;
  volume_30d: string;
  best_bid: string;
  best_bid_size: string;
  best_ask: string;
  best_ask_size: string;
  side: string;
  time: string;
  trade_id: number;
  last_size: string;
}

export type ProductId = 'BTC-USD' | 'ETH-USD' | 'XRP-USD' | 'LTC-USD';

export interface SubscriptionMessage {
  type: 'subscribe' | 'unsubscribe';
  product_ids: ProductId[];
  channels: string[];
}
