import { toast } from 'sonner';

export function showToast(message: string, description?: string): void {
  toast(message, { description });
}

export const useToast = () => {
  return {
    success: (message: string, description?: string): void => {
      toast.success(message, { description });
    },
    error: (message: string, description?: string): void => {
      toast.error(message, { description });
    },
    info: (message: string, description?: string): void => {
      toast.info(message, { description });
    },
  };
};

export { toast };
