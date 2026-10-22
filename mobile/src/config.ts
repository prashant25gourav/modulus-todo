declare const __DEV__: boolean;

export const PROD_API_URL = 'https://modulus-todo.onrender.com';

export const API_BASE_URL =
  typeof __DEV__ !== 'undefined' && __DEV__
    ? 'http://10.0.2.2:5000'
    : PROD_API_URL;

export const API_TIMEOUT_MS = 60000; // 60s timeout for Render free tier cold-starts
