// entrypoints/background/provider-ceremony.ts — Plan 12-02 Task 2 RED stub.
// Real implementation lands in the immediately-following GREEN commit; this
// stub exists only to prove provider-ceremony.test.ts's behavior contract
// actually fails against a naive body before the real orchestration logic
// is written (TDD RED phase).
export interface CreateRpcRequest {
  publicKey: unknown;
}

export interface GetRpcRequest {
  publicKey: unknown;
}

export interface CreateRpcResponse {
  fallthrough: boolean;
  failed?: boolean;
  credentialResponseJson?: string;
  prfCapable?: boolean;
  prfUnavailableReason?: string;
}

export interface GetRpcResponse {
  fallthrough: boolean;
  failed?: boolean;
  credentialResponseJson?: string;
}

export async function handleCredentialsCreate(
  _req: CreateRpcRequest,
  _senderOrigin: string,
): Promise<CreateRpcResponse> {
  return { fallthrough: true };
}

export async function handleCredentialsGet(
  _req: GetRpcRequest,
  _senderOrigin: string,
): Promise<GetRpcResponse> {
  return { fallthrough: true };
}
