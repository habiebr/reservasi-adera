// Thin JSON fetch layer. Admin routes rely on the HttpOnly session cookie; a 401 anywhere
// in the admin area redirects to the login screen via the thrown ApiError.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  let data: Record<string, unknown> = {};
  try {
    data = await res.json();
  } catch {
    /* non-JSON error body */
  }
  if (!res.ok) {
    throw new ApiError(res.status, String(data.error ?? `HTTP ${res.status}`), data);
  }
  return data as T;
}

export const apiGet = <T>(path: string) => request<T>("GET", path);
export const apiPost = <T>(path: string, body?: unknown) => request<T>("POST", path, body);
export const apiPut = <T>(path: string, body?: unknown) => request<T>("PUT", path, body);
export const apiDelete = <T>(path: string) => request<T>("DELETE", path);

// ── shared response shapes ──

export interface PoliOption {
  id: number;
  name: string;
  specializations: { id: number; name: string; bookingOrderType: string }[];
}

export interface DoctorOption {
  id: number;
  name: string;
  sessionDuration: number;
  bookingOrderType: string;
  practiceDays: number[];
  schedules: { id: number; dayOfWeek: number; startTime: string; endTime: string }[];
}

export interface SlotsResponse {
  bookingOrderType: string;
  sessionDuration: number;
  doctorName: string;
  timeSlots: { startTime: string; endTime: string; scheduleId: number; available: boolean }[];
  sessions: { scheduleId: number; startTime: string; endTime: string }[];
}

export interface ProcedureOption {
  id: number;
  name: string;
  price: number;
  isDownPayment: boolean;
  downPaymentAmount: number;
}

export interface ProceduresResponse {
  dp: { enabled: boolean; rule: "calq" | "fixed" | "percent"; value: number | null };
  procedures: ProcedureOption[];
}

export interface BundleOption {
  id: string;
  name: string;
  description: string | null;
  price: number;
  isDownPayment: boolean;
  downPaymentAmount: number;
  items: { name: string; quantity: number; unitPrice: number }[];
}

export interface BundlesResponse {
  dp: { enabled: boolean; rule: "calq" | "fixed" | "percent"; value: number | null };
  bundles: BundleOption[];
}

export interface LookupResponse {
  found: boolean;
  calq_patient_id?: string;
  mrn?: string | null;
  masked_name?: string;
  masked_dob?: string | null;
  masked_phone?: string | null;
  has_email?: boolean;
}

export interface StatusResponse {
  booking_status: string;
  payment_status: string;
  payment_url: string | null;
  invoice_number: string;
  jenis_pembayaran: "LUNAS" | "DP";
  total_amount: number;
  dp_amount: number | null;
  amount_due: number;
  paid_at: string | null;
  visit_date: string;
  slot_time: string | null;
  booking_order_type: string | null;
  doctor_name: string | null;
  specialization_name: string | null;
  polyclinic_name: string | null;
  nama_lengkap: string | null;
  email_masked: string | null;
  booking_code: string | null;
  queue_number: string | null;
  emr_ok: boolean;
  items: { name: string; unitPrice: number; quantity: number }[];
}
