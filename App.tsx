
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality } from '@google/genai';
import { Deduction, DeductionStatus, AppState } from './types';
import { SHERLOCK_SYSTEM_INSTRUCTION, TOOLS } from './constants';
import { Layout } from './components/Layout';
import { DeductionCard } from './components/DeductionCard';
import { 
  blobToBase64, 
  decode, 
  decodeAudioData, 
  encode 
} from './services/geminiService';

const FRAME_RATE = 2;
const JPEG_QUALITY = 0.6;

const App: React.FC = () => {
  const [state, setState] = useState<AppState>({
    isAnalyzing: false,
    deductions: [],
    activeTab: 'field',
    lastObservation: 'System idle. Waiting for visual input.'
  });

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
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
            response: { result: "Case file updated." },
          }
        });
      });
    }
  };

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
          }
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
            if (message.toolCall) message.toolCall.functionCalls.forEach(handleToolCall);
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
      console.error("Session failed to initialize.", err);
    }
  };

  const stopAnalysis = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionPromiseRef.current) sessionPromiseRef.current.then((s: any) => s.close());
    if (videoRef.current?.srcObject) (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
    setState(prev => ({ ...prev, isAnalyzing: false }));
  };

  return (
    <Layout activeTab={state.activeTab} setActiveTab={(tab) => setState(p => ({ ...p, activeTab: tab }))}>
      {/* Observation View */}
      <div className={`absolute inset-0 transition-all duration-700 ease-in-out transform ${state.activeTab === 'field' ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        <div className="h-full flex flex-col p-10 gap-10">
          <div className="flex-1 relative bg-black flex items-center justify-center group">
            <video 
              ref={videoRef} 
              autoPlay 
              playsInline 
              muted 
              className="w-full h-full object-cover grayscale opacity-80 transition-all duration-1000 group-hover:grayscale-0 group-hover:opacity-100"
            />
            <canvas ref={canvasRef} className="hidden" />
            
            <div className="absolute inset-0 bg-gradient-to-t from-black via-transparent to-transparent opacity-60"></div>
            
            {!state.isAnalyzing ? (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-8 bg-black/40 backdrop-blur-sm transition-all">
                <h2 className="font-serif text-4xl text-neutral-200 tracking-tight">Begin Field Observation</h2>
                <button 
                  onClick={startAnalysis}
                  className="px-12 py-4 border border-white/20 hover:border-white text-xs uppercase tracking-[0.4em] transition-all bg-white/5 hover:bg-white hover:text-black"
                >
                  Activate Intelligence
                </button>
              </div>
            ) : (
              <div className="absolute bottom-12 left-1/2 -translate-x-1/2">
                <button 
                  onClick={stopAnalysis}
                  className="px-10 py-3 border border-red-900/40 hover:border-red-500 text-[10px] uppercase tracking-[0.3em] text-red-500 hover:bg-red-500/10 transition-all"
                >
                  End Observation
                </button>
              </div>
            )}
          </div>

          <div className="h-40 flex gap-10 border-t border-[#1a1a1a] pt-10">
            <div className="flex-1 flex flex-col justify-center">
              <span className="text-[9px] uppercase tracking-[0.3em] text-[#525252] mb-3">Live Deduction Stream</span>
              <div className="font-serif text-lg text-neutral-300 italic h-12 overflow-hidden flex items-center">
                {state.deductions.length > 0 
                  ? `"${state.deductions[0].description.substring(0, 120)}..."`
                  : "Scanning surroundings for noteworthy patterns..."}
              </div>
            </div>
            <div className="w-64 border-l border-[#1a1a1a] pl-10 flex flex-col justify-center">
              <span className="text-[9px] uppercase tracking-[0.3em] text-[#525252] mb-1">Case Progress</span>
              <div className="text-3xl font-serif text-white">{state.deductions.length}</div>
              <span className="text-[9px] text-[#404040] uppercase tracking-widest">Active Threads</span>
            </div>
          </div>
        </div>
      </div>

      {/* Mind Palace View */}
      <div className={`absolute inset-0 overflow-y-auto transition-all duration-700 ease-in-out transform ${state.activeTab === 'palace' ? 'translate-y-0 opacity-100' : 'translate-y-10 opacity-0 pointer-events-none'}`}>
        <div className="px-20 py-20 max-w-7xl mx-auto">
          <header className="mb-20">
            <h1 className="font-serif text-6xl text-neutral-100 mb-6 tracking-tight">The Mind Palace</h1>
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
              <p className="font-serif italic text-2xl text-[#404040]">The archive is currently void of certainties.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
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
