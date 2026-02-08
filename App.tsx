
import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Deduction, DeductionStatus, AppState, Observation } from './types';
import { SENSORY_OBSERVER_INSTRUCTION, TOOLS, COGNITION_CORE_INSTRUCTION } from './constants';
import { Layout } from './components/Layout';
import { DeductionCard } from './components/DeductionCard';
import { 
  blobToBase64, 
  decode, 
  decodeAudioData, 
  encode 
} from './services/geminiService';

const FRAME_RATE = 1;
const JPEG_QUALITY = 0.5;
const STORAGE_KEY = 'aegis_engine_state_v10';
const AUTO_AUDIT_INTERVAL = 60000; 

const AudioVisualizer: React.FC<{ stream: MediaStream | null }> = ({ stream }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (!stream || !canvasRef.current) return;
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const source = audioCtx.createMediaStreamSource(stream);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 64;
    source.connect(analyser);
    const dataArray = new Uint8Array(analyser.frequencyBinCount);
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationId: number;
    const draw = () => {
      if (!ctx) return;
      animationId = requestAnimationFrame(draw);
      analyser.getByteFrequencyData(dataArray);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const barWidth = (canvas.width / dataArray.length) * 2.5;
      let x = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const barHeight = (dataArray[i] / 255) * canvas.height;
        ctx.fillStyle = `rgba(255, 255, 255, ${dataArray[i] / 255})`;
        ctx.fillRect(x, canvas.height - barHeight, barWidth, barHeight);
        x += barWidth + 2;
      }
    };
    draw();
    return () => {
      cancelAnimationFrame(animationId);
      audioCtx.close();
    };
  }, [stream]);
  return <canvas ref={canvasRef} width={60} height={16} className="opacity-40" />;
};

const App: React.FC = () => {
  const [state, setState] = useState<AppState>(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const defaults: AppState = {
      isAnalyzing: false, 
      isAuditing: false, 
      deductions: [], 
      observations: [],
      transcripts: [], 
      activeTab: 'field', 
      lastObservation: 'SYSTEM INITIALIZED.'
    };
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return { ...defaults, ...parsed, isAnalyzing: false, isAuditing: false, activeTab: 'field' };
      } catch (e) { console.error("Restore failed", e); }
    }
    return defaults;
  });

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);
  const sessionPromiseRef = useRef<any>(null);
  const auditTimerRef = useRef<number | null>(null);

  useEffect(() => {
    const { isAnalyzing, isAuditing, activeTab, ...persistentData } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentData));
  }, [state.deductions, state.observations, state.transcripts]);

  useEffect(() => {
    if (state.isAnalyzing) {
      auditTimerRef.current = window.setInterval(() => {
        runDeepForensicAudit();
      }, AUTO_AUDIT_INTERVAL);
    } else {
      if (auditTimerRef.current) clearInterval(auditTimerRef.current);
    }
    return () => { if (auditTimerRef.current) clearInterval(auditTimerRef.current); };
  }, [state.isAnalyzing]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef(0);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext; } | null>(null);

  useEffect(() => { transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [state.transcripts]);

  const initAudio = () => {
    if (!audioContextsRef.current) {
      audioContextsRef.current = {
        input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
        output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 })
      };
    }
    return audioContextsRef.current;
  };

  const addTranscript = (text: string, role: 'user' | 'model') => {
    const cleanText = text.replace(/<[^>]*>/g, '').trim();
    if (!cleanText) return;

    setState(prev => ({
      ...prev,
      transcripts: [...prev.transcripts, {
        id: Math.random().toString(36).substr(2, 9),
        role, text: cleanText, timestamp: Date.now()
      }].slice(-250)
    }));
  };

  const captureHighResFrame = (): Promise<string | null> => {
    return new Promise((resolve) => {
      if (canvasRef.current && videoRef.current && state.isAnalyzing) {
        const ctx = canvasRef.current.getContext('2d');
        if (ctx) {
          canvasRef.current.width = videoRef.current.videoWidth;
          canvasRef.current.height = videoRef.current.videoHeight;
          ctx.drawImage(videoRef.current, 0, 0);
          canvasRef.current.toBlob((blob) => {
            if (blob) {
              blobToBase64(blob).then(resolve);
            } else {
              resolve(null);
            }
          }, 'image/jpeg', 0.9);
        } else { resolve(null); }
      } else { resolve(null); }
    });
  };

  const updatePalaceState = (name: string, args: any) => {
    if (!args) return;
    setState(prev => {
      const newDeductions = [...prev.deductions];
      const searchId = (args.id || args.title || "").toLowerCase();
      
      if (name === 'record_deduction') {
        const id = Math.random().toString(36).substr(2, 9);
        newDeductions.unshift({
          id,
          title: args.title || "Logical Vector",
          description: args.description || "Synthesizing deep variables...",
          probability: args.probability ?? 50,
          history: [{ timestamp: Date.now(), value: args.probability ?? 50 }],
          status: DeductionStatus.UNCERTAIN,
          evidence: args.evidence || [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
      } else if (name === 'update_probability') {
        const idx = newDeductions.findIndex(d => 
          d.id.toLowerCase() === searchId || d.title.toLowerCase().includes(searchId)
        );
        if (idx !== -1) {
          const d = { ...newDeductions[idx] };
          d.probability = args.new_probability ?? d.probability;
          d.history = [...d.history, { timestamp: Date.now(), value: d.probability }];
          if (args.reasoning) d.evidence = Array.from(new Set([...d.evidence, args.reasoning]));
          d.updatedAt = Date.now();
          newDeductions[idx] = d;
        }
      } else if (name === 'verify_deduction') {
        const idx = newDeductions.findIndex(d => 
          d.id.toLowerCase() === searchId || d.title.toLowerCase().includes(searchId)
        );
        if (idx !== -1) {
          const d = { ...newDeductions[idx] };
          d.status = (args.status as DeductionStatus) || d.status;
          d.probability = d.status === DeductionStatus.PROVEN ? 100 : (d.status === DeductionStatus.REFUTED ? 0 : d.probability);
          d.history = [...d.history, { timestamp: Date.now(), value: d.probability }];
          if (args.final_reasoning) d.evidence = Array.from(new Set([...d.evidence, args.final_reasoning]));
          d.updatedAt = Date.now();
          newDeductions[idx] = d;
        }
      }
      return { ...prev, deductions: newDeductions };
    });
  };

  const handleToolCall = (fc: any) => {
    const { name, args, id: callId } = fc;
    updatePalaceState(name, args);
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then((session: any) => {
        session.sendToolResponse({ functionResponses: { id: callId, name, response: { result: "AEGIS_LOCAL_SYNC_OK" } } });
      });
    }
  };

  const runDeepForensicAudit = async () => {
    if (state.isAuditing || state.transcripts.length < 3) return;
    
    setState(prev => ({ ...prev, isAuditing: true }));
    
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const currentLog = state.transcripts.slice(-80).map(t => `[${t.role.toUpperCase()}]: ${t.text}`).join('\n');
      const currentPalace = JSON.stringify(state.deductions.map(d => ({ 
        id: d.id, 
        title: d.title, 
        status: d.status, 
        prob: d.probability,
        evidence: d.evidence.slice(-2)
      })), null, 2);
      
      const frame = await captureHighResFrame();
      const promptText = `FORENSIC LOG ARCHIVE:\n${currentLog}\n\nCURRENT LOGICAL MATRIX:\n${currentPalace}`;
      
      const parts: any[] = [{ text: promptText }];
      if (frame) {
        parts.push({ inlineData: { data: frame, mimeType: 'image/jpeg' } });
      }

      const response = await ai.models.generateContent({
        model: 'gemini-3-pro-preview',
        contents: { parts },
        config: {
          systemInstruction: COGNITION_CORE_INSTRUCTION,
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 4096 },
          maxOutputTokens: 2048,
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              updates: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    type: { type: Type.STRING, description: "One of: record_deduction, update_probability, verify_deduction" },
                    args: { 
                      type: Type.OBJECT,
                      properties: {
                        id: { type: Type.STRING },
                        title: { type: Type.STRING },
                        description: { type: Type.STRING },
                        probability: { type: Type.NUMBER },
                        new_probability: { type: Type.NUMBER },
                        reasoning: { type: Type.STRING },
                        status: { type: Type.STRING },
                        final_reasoning: { type: Type.STRING },
                        evidence: { type: Type.ARRAY, items: { type: Type.STRING } }
                      }
                    }
                  },
                  required: ['type', 'args']
                }
              },
              auditSummary: { type: Type.STRING, description: "Synthesis of new logic identified from visuals and text." }
            },
            required: ['updates', 'auditSummary']
          }
        }
      });

      const text = response.text;
      if (text) {
        const result = JSON.parse(text);
        if (result.updates && Array.isArray(result.updates)) {
          result.updates.forEach((u: any) => updatePalaceState(u.type, u.args));
        }
        setState(prev => ({ ...prev, lastObservation: result.auditSummary || prev.lastObservation }));
      }
    } catch (error) {
      console.error("Sherlock Cognition Core Failure:", error);
    } finally {
      setState(prev => ({ ...prev, isAuditing: false }));
    }
  };

  const startAnalysis = async () => {
    if (state.isAnalyzing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: { echoCancellation: true, noiseSuppression: true }
      });
      setMediaStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      
      const { input: inputCtx, output: outputCtx } = initAudio();
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SENSORY_OBSERVER_INSTRUCTION,
          tools: [{ functionDeclarations: TOOLS }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {}, 
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(2048, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmData = encode(new Uint8Array(int16.buffer));
              sessionPromise.then((session: any) => session.sendRealtimeInput({ media: { data: pcmData, mimeType: 'audio/pcm;rate=16000' } }));
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
                      sessionPromise.then((session: any) => session.sendRealtimeInput({ media: { data: base64, mimeType: 'image/jpeg' } }));
                    }
                  }, 'image/jpeg', JPEG_QUALITY);
                }
              }
            }, 1000 / FRAME_RATE);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) message.toolCall.functionCalls.forEach(handleToolCall);
            if (message.serverContent?.inputTranscription) addTranscript(message.serverContent.inputTranscription.text, 'user');
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              addTranscript(text, 'model');
            }
            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData) {
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
              const buffer = await decodeAudioData(decode(audioData), outputCtx, 24000, 1);
              const source = outputCtx.createBufferSource();
              source.buffer = buffer;
              source.connect(outputCtx.destination);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
            }
          },
          onclose: () => setState(prev => ({ ...prev, isAnalyzing: false })),
          onerror: (e) => {
            console.error("Real-time sensory error:", e);
            setState(prev => ({ ...prev, isAnalyzing: false }));
          }
        }
      });
      sessionPromiseRef.current = sessionPromise;
      setState(prev => ({ ...prev, isAnalyzing: true }));
    } catch (err) { 
      console.error("Aegis Link Initiation Failed:", err);
    }
  };

  const stopAnalysis = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionPromiseRef.current) sessionPromiseRef.current.then((s: any) => s.close());
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    setMediaStream(null);
    setState(prev => ({ ...prev, isAnalyzing: false }));
  };

  return (
    <Layout activeTab={state.activeTab} setActiveTab={(tab) => setState(p => ({ ...p, activeTab: tab }))}>
      <div className={`absolute inset-0 flex transition-all duration-700 h-full ${state.activeTab === 'field' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-4'}`}>
        <div className="flex-1 flex flex-col lg:flex-row p-3 md:p-6 gap-3 md:gap-6 overflow-hidden">
          <div className="flex-[2] md:flex-[3] relative bg-[#050505] border border-[#1a1a1a] flex flex-col min-h-0 h-[45vh] lg:h-full shrink-0">
            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain grayscale-[0.8] contrast-125 saturate-50" />
              <canvas ref={canvasRef} className="hidden" />
              {state.isAnalyzing && <div className="scanning-line" />}
              
              <div className="absolute top-4 left-4 glass-panel px-4 py-2 flex items-center gap-4 z-20">
                <div className={`w-1.5 h-1.5 rounded-full ${state.isAnalyzing ? 'bg-white animate-pulse' : 'bg-red-900'}`} />
                <span className="text-[9px] font-mono tracking-[0.2em] text-neutral-400 uppercase">AEGIS-1 Sensory {state.isAnalyzing ? 'LIVE' : 'IDLE'}</span>
                {state.isAnalyzing && <AudioVisualizer stream={mediaStream} />}
              </div>
              {!state.isAnalyzing && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/95 backdrop-blur-3xl z-10 p-6">
                  <h2 className="font-serif text-3xl md:text-5xl text-white mb-10 tracking-tight italic text-center">Engine Initialized.</h2>
                  <button onClick={startAnalysis} className="px-14 py-5 border border-white/20 hover:border-white text-[10px] uppercase tracking-[1em] transition-all bg-white/5 hover:bg-white hover:text-black font-black">Establish Link</button>
                </div>
              )}
            </div>
            <div className="h-16 md:h-24 border-t border-[#1a1a1a] flex items-center justify-between px-6 md:px-12 bg-[#080808]">
              <div className="flex gap-10 md:gap-24">
                <div className="flex flex-col">
                  <span className="text-[8px] uppercase tracking-[0.3em] text-[#444] mb-1 font-bold">Vector Threads</span>
                  <span className="text-xl md:text-4xl font-serif text-white">{state.deductions.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] uppercase tracking-[0.3em] text-[#444] mb-1 font-bold">Global Certainty</span>
                  <span className="text-xl md:text-4xl font-serif text-white">
                    {state.deductions.length > 0 ? Math.round(state.deductions.reduce((a, b) => a + b.probability, 0) / state.deductions.length) : 0}%
                  </span>
                </div>
              </div>
              <div className="flex gap-4">
                <button 
                  onClick={runDeepForensicAudit} 
                  disabled={state.isAuditing || state.transcripts.length < 5} 
                  className={`hidden md:flex items-center gap-3 px-8 py-2.5 border border-white/10 text-[10px] uppercase tracking-[0.4em] text-neutral-400 hover:text-white hover:border-white/40 transition-all font-black bg-white/5 ${state.isAuditing ? 'cursor-wait' : ''}`}
                >
                  {state.isAuditing && <div className="w-3 h-3 border border-white border-t-transparent rounded-full animate-spin" />}
                  {state.isAuditing ? 'SYNCHRONIZING...' : 'Deep Logic Sync'}
                </button>
                {state.isAnalyzing && <button onClick={stopAnalysis} className="px-6 py-2.5 border border-red-900/40 text-[10px] uppercase tracking-[0.3em] text-red-600 hover:bg-red-900/10 transition-colors font-black">Link Kill</button>}
              </div>
            </div>
          </div>
          <div className="flex-1 flex flex-col gap-6 overflow-hidden min-h-[30vh] lg:min-h-0">
            <div className="flex-1 bg-[#080808] border border-[#1a1a1a] flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[#1a1a1a] flex justify-between items-center bg-[#0a0a0a]">
                <span className="text-[9px] uppercase tracking-[0.6em] text-[#555] font-black">Sensory Log Archive</span>
                <span className="text-[8px] uppercase text-neutral-600 font-mono tracking-widest">{state.isAuditing ? 'OMEGA_AUDIT_ACTIVE' : 'IDLE'}</span>
              </div>
              <div className="flex-1 overflow-y-auto p-6 space-y-6 font-serif">
                {state.transcripts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-10">
                    <p className="italic text-[10px] tracking-[0.5em] uppercase">Observation buffer empty.</p>
                  </div>
                ) : (
                  state.transcripts.map(t => (
                    <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <span className={`text-[8px] uppercase tracking-[0.4em] mb-1 ${t.role === 'user' ? 'text-[#333]' : 'text-neutral-500'} font-black`}>{t.role === 'user' ? 'INPUT_S' : 'AEGIS_1'}</span>
                      <p className={`text-[12px] leading-relaxed p-4 rounded-sm ${t.role === 'user' ? 'bg-white/5 text-neutral-500 italic text-right border-r border-white/5' : 'bg-white/10 text-neutral-100 border-l border-white/20'} max-w-[95%]`}>{t.text}</p>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className={`absolute inset-0 overflow-y-auto transition-all duration-1000 ${state.activeTab === 'palace' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-10'}`}>
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-16 md:py-32">
          <header className="mb-24">
            <h1 className="font-serif text-6xl md:text-[10rem] text-neutral-100 tracking-tighter leading-none mb-12">Memory Palace.</h1>
            <div className="flex flex-col md:flex-row gap-8 md:gap-24 border-t border-[#1a1a1a] pt-12 items-start md:items-end">
              <div className="flex gap-20">
                <div><span className="text-6xl font-serif text-white">{state.deductions.filter(d => d.status === DeductionStatus.PROVEN).length}</span><p className="text-[10px] uppercase tracking-[0.6em] text-[#333] mt-3 font-black">Proven Vectors</p></div>
                <div><span className="text-6xl font-serif text-white">{state.deductions.filter(d => d.status === DeductionStatus.REFUTED).length}</span><p className="text-[10px] uppercase tracking-[0.6em] text-[#333] mt-3 font-black">Nullified Loops</p></div>
              </div>
              <button 
                onClick={runDeepForensicAudit} 
                disabled={state.isAuditing || state.transcripts.length === 0} 
                className="px-12 py-5 bg-white text-black font-black uppercase tracking-[0.8em] text-[10px] hover:bg-neutral-200 transition-all disabled:opacity-20 flex items-center gap-4"
              >
                {state.isAuditing && <div className="w-3 h-3 border border-black border-t-transparent rounded-full animate-spin" />}
                {state.isAuditing ? 'SYNCHRONIZING OMEGA...' : 'FORCE COGNITION SYNC'}
              </button>
            </div>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 pb-32">
            {state.deductions.length === 0 ? (
              <div className="col-span-2 py-40 text-center border-t border-[#111] opacity-20"><p className="font-serif italic text-4xl">Waiting for deductive seeding.</p></div>
            ) : (
              state.deductions.map(d => <DeductionCard key={d.id} deduction={d} />)
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};
export default App;
