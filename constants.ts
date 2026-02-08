
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
OUTPUT EXACTLY 1-2 UPDATES. NOTHING MORE.

ABSOLUTE FIELD LIMITS (Violation causes system failure):
- title: 3-4 words ONLY. Max 40 chars. Example: "Gaze Pattern" (12 chars)
- description: Max 50 chars. Example: "User looking upward" (19 chars)
- reasoning: Max 50 chars. Example: "Matches baseline" (16 chars)
- status: PROVEN or REFUTED only
- auditSummary: Max 60 chars. Example: "Baseline confirmed." (19 chars)

FORBIDDEN (BREAKS THE SYSTEM):
X Repetitive text or word duplication
X Long concatenated strings with metadata
X System messages or technical jargon in fields
X More than 2 updates total
X Strings exceeding the character limits above

CORRECT JSON (EXACTLY LIKE THIS):
{
  "updates": [
    {"type": "record_deduction", "args": {"title": "Gaze Pattern", "description": "User looks upward", "probability": 75}}
  ],
  "auditSummary": "Focus shift detected."
}

IF you cannot keep fields SHORT, output:
{"updates": [], "auditSummary": "Unable to generate concise output."}
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
