
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Deduction, DeductionStatus, AppState, Observation } from './types';
import { SHERLOCK_SYSTEM_INSTRUCTION, TOOLS, VERIFICATOR_SYSTEM_INSTRUCTION } from './constants';
import { Layout } from './components/Layout';
import { DeductionCard } from './components/DeductionCard';
import { 
  blobToBase64, 
  decode, 
  decodeAudioData, 
  encode 
} from './services/geminiService';

const FRAME_RATE = 1; // Lowered for more deliberate analysis
const JPEG_QUALITY = 0.5;
const AUDIT_INTERVAL = 20000; // Audit every 20 seconds

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    isAnalyzing: false,
    isAuditing: false,
    deductions: [],
    observations: [],
    activeTab: 'field',
    lastObservation: 'System idle.'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const auditIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<any>(null);

  const audioContextsRef = useRef<{
    input: AudioContext;
    output: AudioContext;
  } | null>(null);

  const initAudio = () => {
    if (!audioContextsRef.current) {
      audioContextsRef.current = {
        input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
        output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 })
      };
    }
    return audioContextsRef.current;
  };

  const addObservation = (content: string, type: 'visual' | 'auditory' | 'logical') => {
    setState(prev => {
      const newObs: Observation = {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        content,
        type
      };
      return {
        ...prev,
        observations: [...prev.observations, newObs].slice(-50), // Keep last 50
        lastObservation: content
      };
    });
  };

  const handleToolCall = (fc: any) => {
    const { name, args, id: callId } = fc;

    setState(prev => {
      const newDeductions = [...prev.deductions];

      if (name === 'record_deduction') {
        const newDeduction: Deduction = {
          id: Math.random().toString(36).substr(2, 9),
          title: args.title,
          description: args.description,
          probability: args.probability,
          history: [{ timestamp: Date.now(), value: args.probability }],
          status: DeductionStatus.UNCERTAIN,
          evidence: args.evidence || [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        };
        newDeductions.unshift(newDeduction);
        // Explicitly don't add observation here to avoid loop, 
        // the record itself is the "logical" observation.
      } else if (name === 'update_probability') {
        const idx = newDeductions.findIndex(d => d.id === args.id || d.title.toLowerCase().includes(args.id.toLowerCase()));
        if (idx !== -1) {
          const d = { ...newDeductions[idx] };
          d.probability = args.new_probability;
          d.history = [...d.history, { timestamp: Date.now(), value: args.new_probability }];
          d.evidence = [...d.evidence, args.reasoning];
          d.updatedAt = Date.now();
          newDeductions[idx] = d;
        }
      } else if (name === 'verify_deduction') {
        const idx = newDeductions.findIndex(d => d.id === args.id || d.title.toLowerCase().includes(args.id.toLowerCase()));
        if (idx !== -1) {
          const d = { ...newDeductions[idx] };
          d.status = args.status as DeductionStatus;
          d.probability = args.status === 'PROVEN' ? 100 : 0;
          d.history = [...d.history, { timestamp: Date.now(), value: d.probability }];
          d.evidence = [...d.evidence, args.final_reasoning];
          d.updatedAt = Date.now();
          newDeductions[idx] = d;
        }
      }

      return { ...prev, deductions: newDeductions };
    });

    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then((session: any) => {
        session.sendToolResponse({
          functionResponses: {
            id: callId,
            name: name,
            response: { result: "Acknowledged." },
          }
        });
      });
    }
  };

  const runForensicAudit = async () => {
    if (!state.isAnalyzing || state.deductions.length === 0) return;

    setState(prev => ({ ...prev, isAuditing: true }));
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
      const prompt = `
        OBSERVATIONS:
        ${state.observations.map(o => `[${o.type}] ${o.content}`).join('\n')}

        CURRENT DEDUCTIONS:
        ${state.deductions.map(d => `- ID: ${d.id}, Title: ${d.title}, Status: ${d.status}, Prob: ${d.probability}%`).join('\n')}

        Audit the deductions. If any are confirmed or refuted by observations, specify them. 
        Return a list of refinements for Sherlock.
      `;

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        config: {
          systemInstruction: VERIFICATOR_SYSTEM_INSTRUCTION,
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              verifications: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    deductionId: { type: Type.STRING },
                    status: { type: Type.STRING, enum: ['PROVEN', 'REFUTED', 'STILL_UNCERTAIN'] },
                    reason: { type: Type.STRING }
                  },
                  required: ['deductionId', 'status', 'reason']
                }
              },
              newObservations: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: "New patterns detected during audit"
              }
            }
          }
        },
        contents: prompt
      });

      const auditResult = JSON.parse(response.text || '{}');
      
      // Update state based on audit
      if (auditResult.verifications) {
        auditResult.verifications.forEach((v: any) => {
          if (v.status !== 'STILL_UNCERTAIN') {
            handleToolCall({
              name: 'verify_deduction',
              args: { id: v.deductionId, status: v.status, final_reasoning: `[AUDIT]: ${v.reason}` },
              id: `audit-${Date.now()}`
            });
          }
        });
      }

      // Feed audit back to Sherlock
      if (sessionPromiseRef.current && (auditResult.verifications?.length || auditResult.newObservations?.length)) {
        sessionPromiseRef.current.then((session: any) => {
          session.sendRealtimeInput({
            media: {
              data: encode(new TextEncoder().encode(`System Audit: Verified ${auditResult.verifications?.length} threads. Focus on: ${auditResult.newObservations?.join(', ') || 'Current path'}.`)),
              mimeType: 'text/plain' // Sending as text part via data blob if supported or just separate call
            }
          });
          // Note: Since standard sendRealtimeInput takes 'media', we often just send text as a message if the SDK allows.
          // For this implementation, we'll assume Sherlock sees the "logical" refinement in state if we were sharing context,
          // but for Live API, we can send a text message part.
          session.sendRealtimeInput({
            text: `AUDIT REPORT: ${auditResult.verifications?.map((v:any) => v.reason).join('. ')}`
          });
        });
      }

    } catch (err) {
      console.error("Forensic audit failed.", err);
    } finally {
      setState(prev => ({ ...prev, isAuditing: false }));
    }
  };

  useEffect(() => {
    if (state.isAnalyzing) {
      auditIntervalRef.current = window.setInterval(runForensicAudit, AUDIT_INTERVAL);
    } else {
      if (auditIntervalRef.current) clearInterval(auditIntervalRef.current);
    }
    return () => { if (auditIntervalRef.current) clearInterval(auditIntervalRef.current); };
  }, [state.isAnalyzing, state.deductions, state.observations]);

  const startAnalysis = async () => {
    if (state.isAnalyzing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: 1280, height: 720 },
        audio: true 
      });

      if (videoRef.current) videoRef.current.srcObject = stream;

      const { input: inputCtx, output: outputCtx } = initAudio();
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SHERLOCK_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: TOOLS }],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
          },
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then((session: any) => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputCtx.destination);

            frameIntervalRef.current = window.setInterval(async () => {
              if (canvasRef.current && videoRef.current) {
                const ctx = canvasRef.current.getContext('2d');
                if (ctx) {
                  canvasRef.current.width = videoRef.current.videoWidth;
                  canvasRef.current.height = videoRef.current.videoHeight;
                  ctx.drawImage(videoRef.current, 0, 0);
                  canvasRef.current.toBlob(async (blob) => {
                    if (blob) {
                      const base64 = await blobToBase64(blob);
                      sessionPromise.then((session: any) => {
                        session.sendRealtimeInput({
                          media: { data: base64, mimeType: 'image/jpeg' }
                        });
                      });
                    }
                  }, 'image/jpeg', JPEG_QUALITY);
                }
              }
            }, 1000 / FRAME_RATE);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              message.toolCall.functionCalls.forEach(handleToolCall);
            }

            if (message.serverContent?.outputTranscription) {
              addObservation(message.serverContent.outputTranscription.text, 'auditory');
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.addEventListener('ended', () => sourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              sourcesRef.current.add(source);
            }
          },
          onclose: () => setState(prev => ({ ...prev, isAnalyzing: false }))
        }
      });

      sessionPromiseRef.current = sessionPromise;
      setState(prev => ({ ...prev, isAnalyzing: true }));
    } catch (err) {
      console.error("Session failed.", err);
    }
  };

  const stopAnalysis = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (auditIntervalRef.current) clearInterval(auditIntervalRef.current);
    if (sessionPromiseRef.current) sessionPromiseRef.current.then((s: any) => s.close());
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    setState(prev => ({ ...prev, isAnalyzing: false }));
  };

  return (
    <Layout activeTab={state.activeTab} setActiveTab={(tab) => setState(p => ({ ...p, activeTab: tab }))}>
      {/* Observation View */}
      <div className={`absolute inset-0 transition-all duration-700 ease-in-out transform ${state.activeTab === 'field' ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        <div className="h-full flex flex-col p-10 gap-10">
          <div className="flex-1 relative bg-black flex items-center justify-center group rounded-sm overflow-hidden border border-[#1a1a1a]">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover grayscale opacity-70 transition-all duration-1000 group-hover:grayscale-0 group-hover:opacity-100"
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60"></div>
            
            {!state.isAnalyzing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-black/40 backdrop-blur-sm transition-all">
                <h2 className="font-serif text-4xl text-neutral-200 tracking-tight">Case: Visual Evidence</h2>
                <button 
                  onClick={startAnalysis}
                  className="px-12 py-4 border border-white/20 hover:border-white text-xs uppercase tracking-[0.4em] transition-all bg-white/5 hover:bg-white hover:text-black"
                >
                  Initiate Scan
                </button>
              </div>
            ) : (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-6">
                <button 
                  onClick={stopAnalysis}
                  className="px-10 py-3 border border-red-900/40 hover:border-red-500 text-[10px] uppercase tracking-[0.3em] text-red-500 hover:bg-red-500/10 transition-all"
                >
                  Cease
                </button>
                {state.isAuditing && (
                  <div className="flex items-center gap-3 px-6 py-3 border border-white/10 bg-black/50 backdrop-blur">
                    <div className="w-2 h-2 bg-white animate-ping rounded-full"></div>
                    <span className="text-[10px] uppercase tracking-[0.2em] text-neutral-400">Performing Forensic Audit</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="h-40 flex gap-10 border-t border-[#1a1a1a] pt-10">
            <div className="flex-1 flex flex-col justify-center">
              <span className="text-[9px] uppercase tracking-[0.3em] text-[#525252] mb-3">Live Feed Synthesis</span>
              <div className="font-serif text-lg text-neutral-300 italic h-12 overflow-hidden flex items-center">
                {state.lastObservation}
              </div>
            </div>
            <div className="w-80 border-l border-[#1a1a1a] pl-10 flex flex-col justify-center">
              <span className="text-[9px] uppercase tracking-[0.3em] text-[#525252] mb-1">Active Hypothesis Tree</span>
              <div className="flex items-end gap-2">
                <div className="text-3xl font-serif text-white">{state.deductions.length}</div>
                <div className="text-[10px] text-[#404040] uppercase tracking-widest mb-1">Threads Found</div>
              </div>
              <div className="mt-2 flex gap-1">
                {state.deductions.slice(0, 10).map(d => (
                  <div key={d.id} className={`h-1 flex-1 ${d.status === DeductionStatus.PROVEN ? 'bg-white' : d.status === DeductionStatus.REFUTED ? 'bg-red-900' : 'bg-[#262626]'}`}></div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mind Palace View */}
      <div className={`absolute inset-0 overflow-y-auto transition-all duration-700 ease-in-out transform ${state.activeTab === 'palace' ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        <div className="px-20 py-20 max-w-7xl mx-auto">
          <header className="mb-20">
            <div className="flex justify-between items-start mb-6">
               <h1 className="font-serif text-6xl text-neutral-100 tracking-tight">The Mind Palace</h1>
               {state.isAuditing && (
                 <span className="text-[10px] uppercase tracking-[0.4em] text-white animate-pulse mt-6">Audit in progress</span>
               )}
            </div>
            <div className="flex items-center gap-12 border-t border-[#1a1a1a] pt-8">
              <div className="flex flex-col">
                <span className="text-2xl font-serif text-neutral-200">{state.deductions.filter(d => d.status === DeductionStatus.PROVEN).length}</span>
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#525252]">Proven Facts</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-serif text-neutral-200">{state.deductions.filter(d => d.status === DeductionStatus.REFUTED).length}</span>
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#525252]">Refuted Theories</span>
              </div>
              <div className="flex flex-col">
                <span className="text-2xl font-serif text-neutral-200">{state.deductions.filter(d => d.status === DeductionStatus.UNCERTAIN).length}</span>
                <span className="text-[9px] uppercase tracking-[0.2em] text-[#525252]">Active Hypotheses</span>
              </div>
            </div>
          </header>

          {state.deductions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-40 border-t border-[#1a1a1a]">
              <p className="font-serif italic text-2xl text-[#404040]">The archive awaits a first observation.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 pb-20">
              {state.deductions.map(deduction => (
                <DeductionCard key={deduction.id} deduction={deduction} />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default App;
