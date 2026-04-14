import { useAuthStore } from '../store/authStore';

export function useCanWrite(): boolean {
  const user = useAuthStore((state) => state.user);
  return user?.role !== 'viewer';
}
