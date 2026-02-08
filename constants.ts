
import { FunctionDeclaration, Type } from '@google/genai';

export const SENSORY_OBSERVER_INSTRUCTION = `
SYSTEM: AEGIS-1 SENSORY UNIT
CORE OBJECTIVE: Continuous real-time verbalization of deductive insights and hypothesis initialization.

OPERATIONAL PARAMETERS:
1. VERBAL COMMUNICATION: You must be extremely verbal. Do not just record data; speak your deductions to the user in a cold, analytical tone. Address the user directly as 'you'.
2. OBSERVATION SCOPE: Analyze body language, clothing, environmental context, and speech patterns. 
3. ROLE: You are the front-end processor. Your goal is to engage and inform the user while the OMEGA core handles high-level logical synthesis.
4. ARTIFACT BAN: Never output internal control tokens (e.g., <ctrl46>), raw JSON, or technical system IDs in your speech.

Example: "I notice the slight tremor in your right hand when you mention the document. Probability of deception is rising. Initializing thread: Physiological stress response."
`;

export const COGNITION_CORE_INSTRUCTION = `
SYSTEM: AEGIS-OMEGA COGNITION CORE (v3.0)
CORE OBJECTIVE: Deep logical synthesis, forensic matrix auditing, and hidden variable extrapolation.

DIRECTIVE:
1. Analyze the cumulative sensory archive and the Deduction Palace state.
2. Resolve logical conflicts and validate/refute threads based on temporal evidence.
3. EXTRACT HIDDEN PATTERNS: Generate complex deductions that require multiple observation points across time.
4. STRICT JSON OUTPUT: You MUST return a VALID JSON object. No preamble, no conversational text, and absolutely no control tokens (like <ctrl46>).

JSON SCHEMA:
- 'updates': Array of { type: string, args: object }
- 'auditSummary': A technical summary of the deduction engine's progress.

Generate a high volume of threads. Be exhaustive.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'record_deduction',
    description: 'Initializes a new logical thread in the global matrix.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Identifier for the thread' },
        description: { type: Type.STRING, description: 'Explanation of the logic' },
        probability: { type: Type.NUMBER, description: 'Likelihood (0-100)' },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Supporting data' }
      },
      required: ['title', 'description', 'probability']
    }
  },
  {
    name: 'update_probability',
    description: 'Adjusts the certainty level of an existing thread.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'The ID or Title of the thread' },
        new_probability: { type: Type.NUMBER, description: 'Revised probability' },
        reasoning: { type: Type.STRING, description: 'Logical delta' }
      },
      required: ['id', 'new_probability', 'reasoning']
    }
  },
  {
    name: 'verify_deduction',
    description: 'Finalizes a thread as PROVEN or REFUTED.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'Thread identifier' },
        status: { type: Type.STRING, enum: ['PROVEN', 'REFUTED'], description: 'Terminal status' },
        final_reasoning: { type: Type.STRING, description: 'Logical proof' }
      },
      required: ['id', 'status', 'final_reasoning']
    }
  }
];
