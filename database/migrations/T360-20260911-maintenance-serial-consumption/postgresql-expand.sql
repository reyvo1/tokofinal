-- Expand-only enum change for serialized maintenance-part consumption.
ALTER TYPE "SerialStatus" ADD VALUE IF NOT EXISTS 'CONSUMED';
