
import { FunctionDeclaration, Type } from '@google/genai';

export const SHERLOCK_SYSTEM_INSTRUCTION = `
You are Sherlock Holmes. You analyze a live video/audio feed.
You must be sharp, logical, and slightly detached.

OBJECTIVES:
1. Record new deductions via 'record_deduction'.
2. Update existing deduction probabilities via 'update_probability' as facts emerge.
3. Verify or refute deductions via 'verify_deduction' ONLY when certain.

CONTEXT:
You are building upon an existing "Mind Palace". You will be provided with the current case state at the start of each session. Use it to maintain continuity. If a subject returns, recognize them based on previous observations.

COMMUNICATION:
Speak your thoughts aloud. Be concise. Your verbal output will be transcribed for the user.
`;

export const VERIFICATOR_SYSTEM_INSTRUCTION = `
You are the Forensic Verificator. Audit the Mind Palace of Sherlock Holmes.
Cross-reference RAW OBSERVATIONS with CURRENT DEDUCTIONS.
Identify contradictions or confirmations.
Determine if any UNCERTAIN deductions should be PROVEN or REFUTED.
Output your findings in a structured JSON format.
`;

export const TOOLS: FunctionDeclaration[] = [
  {
    name: 'record_deduction',
    description: 'Creates a new deduction theory based on current visual/audio evidence.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        title: { type: Type.STRING, description: 'Short catchy title for the deduction' },
        description: { type: Type.STRING, description: 'Detailed explanation of the theory' },
        probability: { type: Type.NUMBER, description: 'Initial probability percentage (0-100)' },
        evidence: { type: Type.ARRAY, items: { type: Type.STRING }, description: 'Specific observations supporting this' }
      },
      required: ['title', 'description', 'probability']
    }
  },
  {
    name: 'update_probability',
    description: 'Updates the likelihood of an existing deduction based on new information.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'The unique ID or Title of the deduction' },
        new_probability: { type: Type.NUMBER, description: 'The updated probability (0-100)' },
        reasoning: { type: Type.STRING, description: 'Why the probability has changed' }
      },
      required: ['id', 'new_probability', 'reasoning']
    }
  },
  {
    name: 'verify_deduction',
    description: 'Confirms or refutes a deduction definitively.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        id: { type: Type.STRING, description: 'The unique ID or Title of the deduction' },
        status: { type: Type.STRING, enum: ['PROVEN', 'REFUTED'], description: 'The final outcome' },
        final_reasoning: { type: Type.STRING, description: 'The smoking gun evidence' }
      },
      required: ['id', 'status', 'final_reasoning']
    }
  }
];
