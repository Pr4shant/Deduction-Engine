
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI, LiveServerMessage, Modality, Type } from '@google/genai';
import { Deduction, DeductionStatus, AppState, Observation, TranscriptItem } from './types';
import { SHERLOCK_SYSTEM_INSTRUCTION, TOOLS, VERIFICATOR_SYSTEM_INSTRUCTION } from './constants';
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
const AUDIT_INTERVAL = 20000;
const STORAGE_KEY = 'sherlock_intelligence_state';

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

  return <canvas ref={canvasRef} width={100} height={20} className="opacity-50" />;
};

const App: React.FC = () => {
  const savedState = localStorage.getItem(STORAGE_KEY);
  const initialState: AppState = useMemo(() => savedState ? JSON.parse(savedState) : {
    isAnalyzing: false,
    isAuditing: false,
    deductions: [],
    observations: [],
    transcripts: [],
    activeTab: 'field',
    lastObservation: 'System idle.'
  }, []);

  const [state, setState] = useState<AppState>({
    ...initialState,
    isAnalyzing: false,
    isAuditing: false
  });

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    const { isAnalyzing, isAuditing, activeTab, ...persistentData } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentData));
  }, [state.deductions, state.observations, state.transcripts]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
  const auditIntervalRef = useRef<number | null>(null);
  const nextStartTimeRef = useRef(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const sessionPromiseRef = useRef<any>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const audioContextsRef = useRef<{
    input: AudioContext;
    output: AudioContext;
  } | null>(null);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [state.transcripts]);

  const initAudio = () => {
    if (!audioContextsRef.current) {
      audioContextsRef.current = {
        input: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 }),
        output: new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 })
      };
    }
    return audioContextsRef.current;
  };

  const addObservation = (content: string, type: Observation['type']) => {
    setState(prev => ({
      ...prev,
      observations: [...prev.observations, {
        id: Math.random().toString(36).substr(2, 9),
        timestamp: Date.now(),
        content,
        type
      }].slice(-50),
      lastObservation: content
    }));
  };

  const addTranscript = (text: string, role: 'user' | 'model') => {
    setState(prev => ({
      ...prev,
      transcripts: [...prev.transcripts, {
        id: Math.random().toString(36).substr(2, 9),
        role,
        text,
        timestamp: Date.now()
      }].slice(-100)
    }));
  };

  const handleToolCall = (fc: any) => {
    const { name, args, id: callId } = fc;
    setState(prev => {
      const newDeductions = [...prev.deductions];
      if (name === 'record_deduction') {
        newDeductions.unshift({
          id: Math.random().toString(36).substr(2, 9),
          title: args.title,
          description: args.description,
          probability: args.probability,
          history: [{ timestamp: Date.now(), value: args.probability }],
          status: DeductionStatus.UNCERTAIN,
          evidence: args.evidence || [],
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
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
          functionResponses: { id: callId, name, response: { result: "Thread updated." } }
        });
      });
    }
  };

  const startAnalysis = async () => {
    if (state.isAnalyzing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } 
      });
      setMediaStream(stream);
      if (videoRef.current) videoRef.current.srcObject = stream;
      
      const { input: inputCtx, output: outputCtx } = initAudio();
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          systemInstruction: SHERLOCK_SYSTEM_INSTRUCTION,
          tools: [{ functionDeclarations: TOOLS }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {}
        },
        callbacks: {
          onopen: () => {
            sessionPromise.then((session: any) => {
              const summary = `INITIALIZING CASE. CURRENT EVIDENCE: ${state.deductions.length} points in palace. Context ready. Proceed.`;
              session.sendRealtimeInput({ text: summary });
            });

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              sessionPromise.then((session: any) => {
                session.sendRealtimeInput({ media: { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' } });
              });
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
              addTranscript(message.serverContent.outputTranscription.text, 'model');
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
    } catch (err) { console.error(err); }
  };

  const stopAnalysis = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionPromiseRef.current) sessionPromiseRef.current.then((s: any) => s.close());
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    setMediaStream(null);
    setState(prev => ({ ...prev, isAnalyzing: false }));
  };

  const clearPalace = () => {
    if (confirm("Reset the Mind Palace?")) {
      setState(prev => ({ ...prev, deductions: [], observations: [], transcripts: [], lastObservation: 'Palace purged.' }));
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <Layout activeTab={state.activeTab} setActiveTab={(tab) => setState(p => ({ ...p, activeTab: tab }))}>
      <div className={`absolute inset-0 flex transition-all duration-700 ${state.activeTab === 'field' ? 'opacity-100' : 'opacity-0 pointer-events-none translate-y-4'}`}>
        <div className="flex-1 flex flex-col lg:flex-row p-6 gap-6 overflow-hidden">
          
          <div className="flex-[3] relative bg-[#050505] border border-[#1a1a1a] rounded-sm overflow-hidden flex flex-col">
            <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain grayscale-[0.3] hover:grayscale-0 transition-all duration-700" />
              <canvas ref={canvasRef} className="hidden" />
              {state.isAnalyzing && <div className="scanning-line" />}
              
              <div className="absolute top-6 left-6 glass-panel px-4 py-2 flex items-center gap-4">
                <div className={`w-2 h-2 rounded-full ${state.isAnalyzing ? 'bg-white animate-pulse' : 'bg-[#333]'}`} />
                <span className="text-[10px] font-mono tracking-widest text-neutral-400 uppercase">
                  {state.isAnalyzing ? 'RELATIONAL MATRIX ACTIVE' : 'SENSORS OFFLINE'}
                </span>
                {state.isAnalyzing && <AudioVisualizer stream={mediaStream} />}
              </div>

              {!state.isAnalyzing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm transition-all">
                  <h2 className="font-serif text-3xl mb-8 tracking-tighter opacity-80">Observations required.</h2>
                  <button onClick={startAnalysis} className="px-10 py-4 border border-white/20 hover:border-white text-[10px] uppercase tracking-[0.5em] transition-all bg-white/5 hover:bg-white hover:text-black font-semibold">
                    Initiate Connection
                  </button>
                </div>
              ) : (
                <div className="absolute bottom-6 left-6 glass-panel px-4 py-3 max-w-lg">
                  <span className="text-[8px] uppercase tracking-[0.3em] text-[#555] font-bold block mb-1">Live Deduction</span>
                  <p className="text-xs font-serif italic text-neutral-300 leading-relaxed">
                    {state.lastObservation}
                  </p>
                </div>
              )}
            </div>
            
            <div className="h-16 border-t border-[#1a1a1a] flex items-center justify-between px-8 bg-[#0a0a0a]">
              <div className="flex gap-12">
                <div className="flex items-center gap-3">
                  <span className="text-[9px] uppercase tracking-widest text-[#444]">Threads</span>
                  <span className="text-xl font-serif">{state.deductions.length}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-[9px] uppercase tracking-widest text-[#444]">Certainty</span>
                  <span className="text-xl font-serif">
                    {state.deductions.length > 0 
                      ? Math.round(state.deductions.reduce((a, b) => a + b.probability, 0) / state.deductions.length)
                      : 0}%
                  </span>
                </div>
              </div>
              {state.isAnalyzing && (
                <button onClick={stopAnalysis} className="text-[10px] uppercase tracking-widest text-red-700 hover:text-red-500 transition-colors font-bold">
                  Disconnect
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-6 overflow-hidden min-w-[320px]">
            <div className="flex-1 bg-[#080808] border border-[#1a1a1a] flex flex-col overflow-hidden">
              <div className="p-4 border-b border-[#1a1a1a] flex justify-between items-center bg-[#0a0a0a]">
                <span className="text-[9px] uppercase tracking-[0.3em] text-[#555] font-bold">Forensic Log</span>
                <button onClick={clearPalace} className="text-[8px] uppercase tracking-widest text-red-900 hover:text-red-600">Purge</button>
              </div>
              <div className="flex-1 overflow-y-auto p-5 space-y-6 font-serif">
                {state.transcripts.length === 0 ? (
                  <p className="text-[#222] italic text-sm text-center mt-20">The archive is silent.</p>
                ) : (
                  state.transcripts.map(t => (
                    <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <span className={`text-[8px] uppercase tracking-widest mb-1 ${t.role === 'user' ? 'text-[#333]' : 'text-neutral-500'}`}>
                        {t.role === 'user' ? 'Observation' : 'Sherlock'}
                      </span>
                      <p className={`text-[13px] leading-relaxed ${t.role === 'user' ? 'text-neutral-500 italic text-right max-w-[80%]' : 'text-neutral-200 max-w-[90%]'}`}>
                        {t.text}
                      </p>
                    </div>
                  ))
                )}
                <div ref={transcriptEndRef} />
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className={`absolute inset-0 overflow-y-auto transition-all duration-700 ${state.activeTab === 'palace' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-12'}`}>
        <div className="max-w-6xl mx-auto px-12 py-24">
          <header className="mb-24 border-b border-[#1a1a1a] pb-12">
            <h1 className="font-serif text-8xl text-neutral-100 tracking-tighter mb-8">Case File.</h1>
            <div className="flex gap-20">
              <div>
                <span className="text-3xl font-serif text-white">{state.deductions.filter(d => d.status === DeductionStatus.PROVEN).length}</span>
                <p className="text-[10px] uppercase tracking-widest text-[#444] mt-2 font-bold">Established Facts</p>
              </div>
              <div>
                <span className="text-3xl font-serif text-white">{state.deductions.filter(d => d.status === DeductionStatus.REFUTED).length}</span>
                <p className="text-[10px] uppercase tracking-widest text-[#444] mt-2 font-bold">Discarded Theories</p>
              </div>
            </div>
          </header>
          <div className="grid grid-cols-1 gap-6 pb-20">
            {state.deductions.length === 0 ? (
              <div className="py-24 text-center">
                <p className="font-serif italic text-3xl text-[#1a1a1a]">Logic is the only weapon. Use it.</p>
              </div>
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
