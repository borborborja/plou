import { api } from '../api';

export type PushStatus = 'unsupported' | 'denied' | 'granted' | 'default';

export function pushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushStatus(): PushStatus {
  if (!pushSupported()) return 'unsupported';
  return Notification.permission as PushStatus;
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalised = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalised);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) output[i] = raw.charCodeAt(i);
  return output;
}

let registration: ServiceWorkerRegistration | null = null;

export async function registerServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  if (registration) return registration;
  try {
    registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
    return registration;
  } catch {
    return null;
  }
}

/**
 * Pide permiso y registra la suscripción push en el servidor.
 * Devuelve el estado resultante para que la interfaz lo refleje.
 */
export async function enablePush(vapidPublicKey: string): Promise<PushStatus> {
  if (!pushSupported()) return 'unsupported';
  if (!vapidPublicKey) return 'unsupported';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission as PushStatus;

  const reg = await registerServiceWorker();
  if (!reg) return 'unsupported';
  await navigator.serviceWorker.ready;

  const existing = await reg.pushManager.getSubscription();
  const subscription =
    existing ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
    }));

  await api.subscribePush(subscription.toJSON());
  return 'granted';
}

export async function disablePush(): Promise<void> {
  const reg = await registerServiceWorker();
  if (!reg) return;
  const subscription = await reg.pushManager.getSubscription();
  if (!subscription) return;
  await api.unsubscribePush(subscription.endpoint).catch(() => undefined);
  await subscription.unsubscribe().catch(() => undefined);
}

export async function hasActiveSubscription(): Promise<boolean> {
  if (!pushSupported()) return false;
  const reg = await registerServiceWorker();
  if (!reg) return false;
  return (await reg.pushManager.getSubscription()) !== null;
}
