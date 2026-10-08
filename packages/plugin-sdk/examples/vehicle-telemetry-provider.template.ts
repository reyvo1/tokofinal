export interface VehicleTelemetryPoint { vehicleId: string; recordedAt: string; latitude?: number; longitude?: number; odometer?: number; speed?: number; fuelLevel?: number; raw?: unknown }
export interface VehicleTelemetryProvider {
  code: string;
  pullSince(cursor?: string): Promise<{ points: VehicleTelemetryPoint[]; nextCursor?: string }>;
  verifyWebhook?(headers: Record<string,string>, body: string): Promise<boolean>;
}
