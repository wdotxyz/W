import AsyncStorage from "@react-native-async-storage/async-storage";

export const API_BASE = `${process.env.EXPO_PUBLIC_BACKEND_URL}/api`;

let _token: string | null = null;

export async function getToken(): Promise<string | null> {
  if (_token) return _token;
  _token = await AsyncStorage.getItem("wave_token");
  return _token;
}

export async function setToken(t: string | null) {
  _token = t;
  if (t) await AsyncStorage.setItem("wave_token", t);
  else await AsyncStorage.removeItem("wave_token");
}

export async function api<T = any>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = await getToken();
  const headers: any = {
    "Content-Type": "application/json",
    ...(options.headers || {}),
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { ...options, headers });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status}`);
  }
  return res.json();
}

export function wsUrl(token: string) {
  const base = (process.env.EXPO_PUBLIC_BACKEND_URL || "").replace(
    /^http/,
    "ws"
  );
  return `${base}/api/ws?token=${encodeURIComponent(token)}`;
}
