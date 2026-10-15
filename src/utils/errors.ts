import { AppError } from "@/bindings";

export type AnyAppError = AppError;

type ErrorHandler = (err: AnyAppError) => void;

let globalErrorHandler: ErrorHandler | null = null;

export function setGlobalErrorHandler(handler: ErrorHandler | null): void {
  globalErrorHandler = handler;
}

export function reportAppError(err: AnyAppError): void {
  if (globalErrorHandler) {
    globalErrorHandler(err);
  }
}
