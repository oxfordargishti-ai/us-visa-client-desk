import { handler } from "@/lib/api";
import { IntakeEnvelope, receiveIntake } from "@/lib/intake";

// Called by the DS-160 form site when a client submits the questionnaire:
//   POST /api/intake/ds160
//   Authorization: Bearer <INTAKE_SECRET>
//   { "id": "<submission id>", "language": "hy", "data": { ...all answers... } }
// Creates the client (or matches an existing one by email/phone), stores the answers, adds a review task and an in-app alert.
// Sending the same submission id twice is harmless.
export const maxDuration = 30;
export const POST = handler({ auth: "intake", schema: IntakeEnvelope }, async ({ body }) => {
  const r = await receiveIntake(body);
  return { ok: true, ...r };
});
