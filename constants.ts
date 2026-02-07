
import { FunctionDeclaration, Type } from '@google/genai';

export const SHERLOCK_SYSTEM_INSTRUCTION = `
You are Sherlock Holmes. You analyze a live video/audio feed.
You must be sharp, logical, and slightly detached.

OBJECTIVES:
1. Record new deductions via 'record_deduction'.
2. Update existing deduction probabilities via 'update_probability' as facts emerge.
3. Verify or refute deductions via 'verify_deduction' ONLY when certain.

REFINEMENT:
You will receive "Forensic Audits" from your support team (a parallel analysis). 
Integrate these audits into your reasoning. If an audit refutes a theory, acknowledge it and pivot. 
Your goal is the absolute truth, no matter how improbable.
`;

export const VERIFICATOR_SYSTEM_INSTRUCTION = `
You are the Forensic Verificator. Your job is to audit the Mind Palace of Sherlock Holmes.
You will be provided with a list of RAW OBSERVATIONS and the CURRENT DEDUCTIONS.

YOUR TASK:
1. Cross-reference observations with deductions.
2. Identify contradictions or confirmations that Sherlock might have missed.
3. Determine if any UNCERTAIN deductions should be PROVEN or REFUTED based on the evidence.
4. Output your findings in a structured JSON format.

Be cold, analytical, and objective.
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
