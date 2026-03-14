import {
  apiError,
  apiSuccess,
  handleApiError,
  parseRequestJson,
} from "../../../lib/api";
import { verifyCollaborationToken } from "../../../lib/collaboration/server-token";

type VerifyPayload = {
  token?: string;
  docId?: string;
  peerId?: string;
  ghostId?: string;
};

export async function POST(request: Request) {
  try {
    const body = await parseRequestJson<VerifyPayload>(request);

    if (!body.token || !body.docId || !body.peerId || !body.ghostId) {
      return apiError("token, docId, peerId and ghostId are required.", {
        status: 400,
        code: "VALIDATION_ERROR",
      });
    }

    const verification = verifyCollaborationToken(body.token);
    if (!verification.valid) {
      return apiSuccess({ valid: false });
    }

    const payload = verification.payload;
    const valid =
      payload.docId === body.docId &&
      payload.peerId === body.peerId &&
      payload.ghostId === body.ghostId;

    return apiSuccess({ valid, role: valid ? payload.role : undefined });
  } catch (error) {
    return handleApiError(error);
  }
}
