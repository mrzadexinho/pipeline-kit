export interface ResourceEnvelope {
  id: string;
  object: string;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface ErrorEnvelope {
  type: string;
  code: string;
  message: string;
  param?: string;
  doc_url?: string;
  request_id?: string;
}
