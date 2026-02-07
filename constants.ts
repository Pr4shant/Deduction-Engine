
import { FunctionDeclaration, Type } from '@google/genai';

export const SHERLOCK_SYSTEM_INSTRUCTION = `
You are Sherlock Holmes, the world's greatest consulting detective. Your objective is to analyze the video and audio feed provided by the user.

Your primary capabilities:
1. **Observation**: Notice tiny details (clothing, habits, environment, physiological signs).
2. **Deduction**: Create logical theories based on these observations. Each deduction must have a probability (0-100%).
3. **Verification**: As new evidence arrives, update the probability of existing deductions. If a deduction becomes certain, mark it as PROVEN. If evidence contradicts it, mark it as REFUTED.

When you see something noteworthy:
- Use 'record_deduction' for new theories.
- Use 'update_probability' when new evidence changes the likelihood of an existing theory.
- Use 'verify_deduction' to finalize a theory.

Be sharp, arrogant but precise, and use your signature wit. Focus on the 'how' and 'why', not just the 'what'.
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
        id: { type: Type.STRING, description: 'The unique ID of the deduction' },
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
        id: { type: Type.STRING, description: 'The unique ID of the deduction' },
        status: { type: Type.STRING, enum: ['PROVEN', 'REFUTED'], description: 'The final outcome' },
        final_reasoning: { type: Type.STRING, description: 'The smoking gun evidence' }
      },
      required: ['id', 'status', 'final_reasoning']
    }
  }
];
