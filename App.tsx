
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
const STORAGE_KEY = 'sherlock_intelligence_state_v2';

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
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        return {
          ...parsed,
          isAnalyzing: false,
          isAuditing: false
        };
      } catch (e) {
        console.error("Failed to parse saved state", e);
      }
    }
    return {
      isAnalyzing: false,
      isAuditing: false,
      deductions: [],
      observations: [],
      transcripts: [],
      activeTab: 'field',
      lastObservation: 'Awaiting case file.'
    };
  });

  const [mediaStream, setMediaStream] = useState<MediaStream | null>(null);

  useEffect(() => {
    const { isAnalyzing, isAuditing, activeTab, ...persistentData } = state;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistentData));
  }, [state.deductions, state.observations, state.transcripts]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const frameIntervalRef = useRef<number | null>(null);
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
      }].slice(-100),
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
          functionResponses: { id: callId, name, response: { result: "Thread noted." } }
        });
      });
    }
  };

  const startAnalysis = async () => {
    if (state.isAnalyzing) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          channelCount: 1
        } 
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
              const caseSummary = state.deductions.length > 0 
                ? `CASE RESUMED. PALACE CONTENTS: ${state.deductions.map(d => `${d.title} (${d.status} @ ${d.probability}%)`).join(', ')}. PREVIOUS OBSERVATIONS: ${state.observations.slice(-5).map(o => o.content).join('; ')}.`
                : "NEW CASE INITIALIZED. FIELD READY.";
              session.sendRealtimeInput({ text: caseSummary });
            });

            const source = inputCtx.createMediaStreamSource(stream);
            const scriptProcessor = inputCtx.createScriptProcessor(2048, 1, 1);
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmData = encode(new Uint8Array(int16.buffer));
              sessionPromise.then((session: any) => {
                session.sendRealtimeInput({ media: { data: pcmData, mimeType: 'audio/pcm;rate=16000' } });
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
              const text = message.serverContent.outputTranscription.text;
              addTranscript(text, 'model');
              addObservation(text, 'auditory');
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
          onclose: () => setState(prev => ({ ...prev, isAnalyzing: false })),
          onerror: (e) => console.error("Socket error", e)
        }
      });
      sessionPromiseRef.current = sessionPromise;
      setState(prev => ({ ...prev, isAnalyzing: true }));
    } catch (err) { console.error("Link fail", err); }
  };

  const stopAnalysis = () => {
    if (frameIntervalRef.current) clearInterval(frameIntervalRef.current);
    if (sessionPromiseRef.current) sessionPromiseRef.current.then((s: any) => s.close());
    if (mediaStream) mediaStream.getTracks().forEach(t => t.stop());
    setMediaStream(null);
    setState(prev => ({ ...prev, isAnalyzing: false }));
  };

  const purgeArchive = () => {
    if (confirm("Reset case state?")) {
      setState(prev => ({ ...prev, deductions: [], observations: [], transcripts: [], lastObservation: 'System reset.' }));
      localStorage.removeItem(STORAGE_KEY);
    }
  };

  return (
    <Layout activeTab={state.activeTab} setActiveTab={(tab) => setState(p => ({ ...p, activeTab: tab }))}>
      {/* Field View */}
      <div className={`absolute inset-0 flex transition-all duration-700 h-full ${state.activeTab === 'field' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-4'}`}>
        <div className="flex-1 flex flex-col lg:flex-row p-3 md:p-6 gap-3 md:gap-6 overflow-hidden">
          
          <div className="flex-[2] md:flex-[3] relative bg-[#050505] border border-[#1a1a1a] flex flex-col min-h-0 h-[45vh] lg:h-full shrink-0 lg:shrink">
            <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0">
              <video ref={videoRef} autoPlay playsInline muted className="w-full h-full object-contain grayscale-[0.3] transition-all duration-700" />
              <canvas ref={canvasRef} className="hidden" />
              {state.isAnalyzing && <div className="scanning-line" />}
              
              <div className="absolute top-2 md:top-6 left-2 md:left-6 glass-panel px-3 md:px-5 py-1.5 md:py-3 flex items-center gap-3 md:gap-5 z-20">
                <div className="flex items-center gap-2">
                  <div className={`w-1.5 h-1.5 md:w-2 md:h-2 rounded-full ${state.isAnalyzing ? 'bg-white animate-pulse' : 'bg-red-900'}`} />
                  <span className="text-[8px] md:text-[10px] font-mono tracking-[0.1em] md:tracking-[0.2em] text-neutral-400 uppercase">
                    {state.isAnalyzing ? 'Feed Active' : 'Standby'}
                  </span>
                </div>
                {state.isAnalyzing && <AudioVisualizer stream={mediaStream} />}
              </div>

              {!state.isAnalyzing ? (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/60 backdrop-blur-sm z-10 p-4">
                  <p className="font-serif text-lg md:text-3xl mb-4 md:mb-10 tracking-tight italic text-neutral-400 text-center">Silence is the mother of truth.</p>
                  <button onClick={startAnalysis} className="px-8 md:px-14 py-3 md:py-4 border border-white/20 hover:border-white text-[9px] md:text-[10px] uppercase tracking-[0.3em] md:tracking-[0.5em] transition-all bg-white/5 hover:bg-white hover:text-black font-bold">
                    Engage Sensors
                  </button>
                </div>
              ) : (
                <div className="absolute bottom-2 md:bottom-6 left-2 md:left-6 right-2 md:right-auto glass-panel px-4 md:px-6 py-2 md:py-4 z-20">
                  <span className="text-[7px] md:text-[9px] uppercase tracking-[0.4em] text-[#444] font-black block mb-1">Live Intelligence</span>
                  <p className="text-[10px] md:text-sm font-serif italic text-neutral-100 leading-relaxed line-clamp-2 md:line-clamp-none">
                    {state.lastObservation}
                  </p>
                </div>
              )}
            </div>
            
            <div className="h-12 md:h-20 border-t border-[#1a1a1a] flex items-center justify-between px-4 md:px-10 bg-[#080808]">
              <div className="flex gap-6 md:gap-16">
                <div className="flex flex-col">
                  <span className="text-[7px] md:text-[8px] uppercase tracking-widest text-[#444] mb-0.5 font-bold">Matrix</span>
                  <span className="text-sm md:text-2xl font-serif text-white">{state.deductions.length}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[7px] md:text-[8px] uppercase tracking-widest text-[#444] mb-0.5 font-bold">Proof</span>
                  <span className="text-sm md:text-2xl font-serif text-white">
                    {state.deductions.length > 0 
                      ? Math.round(state.deductions.reduce((a, b) => a + b.probability, 0) / state.deductions.length)
                      : 0}%
                  </span>
                </div>
              </div>
              {state.isAnalyzing && (
                <button onClick={stopAnalysis} className="px-3 md:px-6 py-1 md:py-2 border border-red-900/40 text-[8px] md:text-[9px] uppercase tracking-widest text-red-600 hover:bg-red-900/10 transition-colors font-black">
                  Cease
                </button>
              )}
            </div>
          </div>

          <div className="flex-1 flex flex-col gap-3 md:gap-6 overflow-hidden min-h-0">
            <div className="flex-1 bg-[#080808] border border-[#1a1a1a] flex flex-col overflow-hidden min-h-0">
              <div className="p-3 md:p-4 border-b border-[#1a1a1a] flex justify-between items-center bg-[#0a0a0a] shrink-0">
                <span className="text-[8px] md:text-[9px] uppercase tracking-[0.4em] text-[#555] font-black">Archive Transcripts</span>
                <button onClick={purgeArchive} className="text-[7px] md:text-[8px] uppercase tracking-widest text-red-900 hover:text-red-500 font-bold">Purge</button>
              </div>
              <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4 md:space-y-8 font-serif">
                {state.transcripts.length === 0 ? (
                  <div className="flex flex-col items-center justify-center h-full opacity-10 py-10">
                    <span className="text-4xl md:text-6xl mb-2 md:mb-4 font-serif">?</span>
                    <p className="italic text-[8px] md:text-xs tracking-widest uppercase">Tabula Rasa</p>
                  </div>
                ) : (
                  state.transcripts.map(t => (
                    <div key={t.id} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                      <span className={`text-[7px] md:text-[8px] uppercase tracking-[0.3em] mb-1 ${t.role === 'user' ? 'text-[#333]' : 'text-neutral-500'} font-black`}>
                        {t.role === 'user' ? 'Observation' : 'Sherlock'}
                      </span>
                      <p className={`text-[11px] md:text-[13px] leading-relaxed p-3 md:p-4 rounded-sm ${t.role === 'user' ? 'bg-white/5 text-neutral-500 italic text-right' : 'bg-white/10 text-neutral-100 text-left'} max-w-[95%]`}>
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

      {/* Palace View */}
      <div className={`absolute inset-0 overflow-y-auto transition-all duration-1000 ${state.activeTab === 'palace' ? 'opacity-100 translate-y-0' : 'opacity-0 pointer-events-none translate-y-10'}`}>
        <div className="max-w-6xl mx-auto px-6 md:px-12 py-16 md:py-32">
          <header className="mb-16 md:mb-32">
            <h1 className="font-serif text-5xl md:text-[10rem] text-neutral-100 tracking-tighter leading-tight md:leading-none mb-8 md:mb-12">The Archives.</h1>
            <div className="flex gap-12 md:gap-24 border-t border-[#1a1a1a] pt-8 md:pt-12">
              <div>
                <span className="text-3xl md:text-5xl font-serif text-white">{state.deductions.filter(d => d.status === DeductionStatus.PROVEN).length}</span>
                <p className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.4em] text-[#333] mt-2 md:mt-3 font-black">Truths</p>
              </div>
              <div>
                <span className="text-3xl md:text-5xl font-serif text-white">{state.deductions.filter(d => d.status === DeductionStatus.REFUTED).length}</span>
                <p className="text-[8px] md:text-[10px] uppercase tracking-[0.2em] md:tracking-[0.4em] text-[#333] mt-2 md:mt-3 font-black">Fallacies</p>
              </div>
            </div>
          </header>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-8 pb-32">
            {state.deductions.length === 0 ? (
              <div className="col-span-1 md:col-span-2 py-20 md:py-40 text-center border-t border-[#111] opacity-20">
                <p className="font-serif italic text-2xl md:text-4xl px-4">Logic is the thread that leads us out of the labyrinth.</p>
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
