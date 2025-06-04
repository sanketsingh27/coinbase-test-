"use client";

import { useState, useEffect, useRef } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type ProductId = 'BTC-USD' | 'ETH-USD' | 'XRP-USD' | 'LTC-USD';

interface TickerData {
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

const PRODUCTS: ProductId[] = ['BTC-USD', 'ETH-USD', 'XRP-USD', 'LTC-USD'];

export default function Home() {
  const [activeTab, setActiveTab] = useState('subscribe');
  const [subscribed, setSubscribed] = useState<Set<ProductId>>(new Set());
  const [tickerData, setTickerData] = useState<Record<ProductId, TickerData | null>>({
    'BTC-USD': null,
    'ETH-USD': null,
    'XRP-USD': null,
    'LTC-USD': null,
  });
  const ws = useRef<WebSocket | null>(null);

  useEffect(() => {
    // Initialize WebSocket connection
    ws.current = new WebSocket('wss://ws-feed.exchange.coinbase.com');

    ws.current.onopen = () => {
      console.log('WebSocket Connected');
    };

    ws.current.onmessage = (event) => {
      const data: TickerData = JSON.parse(event.data);
      if (data.type === 'ticker') {
        setTickerData(prev => ({
          ...prev,
          [data.product_id]: data
        }));
      }
    };

    ws.current.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    return () => {
      ws.current?.close();
    };
  }, []);

  const subscribe = (productId: ProductId) => {
    if (!ws.current) return;
    
    const message = {
      type: 'subscribe',
      product_ids: [productId],
      channels: ['level2', 'matches',{
        "name": "ticker",
        "product_ids": [productId]
      }]
    };
    
    ws.current.send(JSON.stringify(message));
    setSubscribed(prev => new Set([...prev, productId]));
  };

  const unsubscribe = (productId: ProductId) => {
    if (!ws.current) return;
    
    const message = {
      type: 'unsubscribe',
      product_ids: [productId],
      channels: ['level2', 'matches']
    };
    
    ws.current.send(JSON.stringify(message));
    setSubscribed(prev => {
      const newSet = new Set(prev);
      newSet.delete(productId);
      return newSet;
    });
  };

  const toggleSubscription = (productId: ProductId) => {
    if (subscribed.has(productId)) {
      unsubscribe(productId);
    } else {
      subscribe(productId);
    }
  };

  return (
    <main className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6">Coinbase WebSocket Feed</h1>
      
      <Tabs defaultValue="subscribe" className="w-full">
        <TabsList className="grid w-full grid-cols-4 mb-6">
          <TabsTrigger value="subscribe" onClick={() => setActiveTab('subscribe')}>
            Subscribe/Unsubscribe
          </TabsTrigger>
          <TabsTrigger value="price"  onClick={() => setActiveTab('price')}>
            Price Tab
          </TabsTrigger>
          <TabsTrigger value="match" onClick={() => setActiveTab('match')}>
            Match View
          </TabsTrigger>
          <TabsTrigger value="status" onClick={() => setActiveTab('status')}>
            System Status
          </TabsTrigger>
        </TabsList>

        <TabsContent value="subscribe">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {PRODUCTS.map((productId) => {
              const isSubscribed = subscribed.has(productId);
              const data = tickerData[productId];
              
              return (
                <div key={productId} className="border rounded-lg p-4 shadow-sm">
                  <div className="flex justify-between items-center mb-2">
                    <h3 className="font-semibold">{productId}</h3>
                    <span className={`px-2 py-1 text-xs rounded-full ${
                      isSubscribed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                    }`}>
                      {isSubscribed ? 'Subscribed' : 'Not Subscribed'}
                    </span>
                  </div>
                  
                  {data && (
                    <div className="space-y-1 text-sm">
                      <p>Price: ${parseFloat(data.price).toLocaleString()}</p>
                      <p>24h High: ${parseFloat(data.high_24h).toLocaleString()}</p>
                      <p>24h Low: ${parseFloat(data.low_24h).toLocaleString()}</p>
                      <p>24h Volume: {parseFloat(data.volume_24h).toLocaleString()}</p>
                    </div>
                  )}
                  
                  <button
                    onClick={() => toggleSubscription(productId)}
                    className={`mt-3 w-full py-2 rounded-md text-sm font-medium ${
                      isSubscribed 
                        ? 'bg-red-100 text-red-700 hover:bg-red-200' 
                        : 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                    }`}
                  >
                    {isSubscribed ? 'Unsubscribe' : 'Subscribe'}
                  </button>
                </div>
              );
            })}
          </div>
        </TabsContent>

        <TabsContent value="price">
          <div className="p-4 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Price Data</h2>
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Price</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">24h Change</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">24h Volume</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {PRODUCTS.map((productId) => {
                    const data = tickerData[productId];
                    if (!data) return null;
                    
                    const openPrice = parseFloat(data.open_24h);
                    const currentPrice = parseFloat(data.price);
                    const change = ((currentPrice - openPrice) / openPrice) * 100;
                    
                    return (
                      <tr key={productId}>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm font-medium text-gray-900">{productId}</div>
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap">
                          <div className="text-sm text-gray-900">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
                        </td>
                        <td className={`px-6 py-4 whitespace-nowrap text-sm ${change >= 0 ? 'text-green-600' : 'text-red-600'}`}>
                          {change >= 0 ? '↑' : '↓'} {Math.abs(change).toFixed(2)}%
                        </td>
                        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                          {parseFloat(data.volume_24h).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="match">
          <div className="p-4 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">Recent Matches</h2>
            <div className="space-y-4">
              {PRODUCTS.filter(id => subscribed.has(id)).map((productId) => {
                const data = tickerData[productId];
                if (!data) return null;
                
                return (
                  <div key={productId} className="border-b pb-4 last:border-b-0">
                    <h3 className="font-medium">{productId}</h3>
                    <div className="grid grid-cols-2 gap-2 text-sm mt-2">
                      <div>
                        <span className="text-gray-500">Last Trade:</span>{' '}
                        <span className="font-mono">{parseFloat(data.last_size).toFixed(8)} @ ${parseFloat(data.price).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Side:</span>{' '}
                        <span className={data.side === 'buy' ? 'text-green-600' : 'text-red-600'}>
                          {data.side.toUpperCase()}
                        </span>
                      </div>
                      <div>
                        <span className="text-gray-500">Best Bid:</span>{' '}
                        <span className="font-mono">${parseFloat(data.best_bid).toLocaleString()}</span>
                      </div>
                      <div>
                        <span className="text-gray-500">Best Ask:</span>{' '}
                        <span className="font-mono">${parseFloat(data.best_ask).toLocaleString()}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
              {PRODUCTS.filter(id => !subscribed.has(id)).length > 0 && (
                <p className="text-sm text-gray-500 text-center py-4">
                  Subscribe to products to see their match data
                </p>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="status">
          <div className="p-4 border rounded-lg">
            <h2 className="text-xl font-semibold mb-4">System Status</h2>
            <div className="space-y-4">
              <div className="p-4 bg-green-50 border border-green-200 rounded-md">
                <div className="flex">
                  <div className="flex-shrink-0">
                    <svg className="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                    </svg>
                  </div>
                  <div className="ml-3">
                    <p className="text-sm font-medium text-green-800">
                      WebSocket Connection: Connected
                    </p>
                  </div>
                </div>
              </div>
              
              <div className="border rounded-md overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Product</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                      <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Last Update</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {PRODUCTS.map((productId) => {
                      const data = tickerData[productId];
                      const isSubscribed = subscribed.has(productId);
                      
                      return (
                        <tr key={productId}>
                          <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                            {productId}
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap">
                            <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                              isSubscribed ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'
                            }`}>
                              {isSubscribed ? 'Active' : 'Inactive'}
                            </span>
                          </td>
                          <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                            {data ? new Date(data.time).toLocaleTimeString() : 'Never'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              
              <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-md">
                <h3 className="text-sm font-medium text-blue-800">Connection Details</h3>
                <div className="mt-2 text-sm text-blue-700">
                  <p>WebSocket Endpoint: wss://ws-feed.exchange.coinbase.com</p>
                  <p className="mt-1">Connected Products: {subscribed.size} of {PRODUCTS.length}</p>
                </div>
              </div>
            </div>
          </div>
        </TabsContent>
      </Tabs>
    </main>
  );
}
