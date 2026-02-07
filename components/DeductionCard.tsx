
import React from 'react';
import { Deduction, DeductionStatus } from '../types';
import { 
  LineChart, 
  Line, 
  XAxis, 
  YAxis, 
  ResponsiveContainer, 
  Tooltip,
  ReferenceLine
} from 'recharts';

interface DeductionCardProps {
  deduction: Deduction;
}

export const DeductionCard: React.FC<DeductionCardProps> = ({ deduction }) => {
  const isProven = deduction.status === DeductionStatus.PROVEN;
  const isRefuted = deduction.status === DeductionStatus.REFUTED;

  return (
    <div className={`p-8 bg-[#141414] border border-[#262626] transition-all duration-700 hover:border-[#404040] group`}>
      <div className="flex justify-between items-start mb-6">
        <div className="flex-1 pr-4">
          <div className="flex items-center gap-3 mb-2">
             <span className={`text-[9px] uppercase font-bold tracking-[0.15em] px-2 py-0.5 border ${
               isProven ? 'border-white text-white' : 
               isRefuted ? 'border-red-900/50 text-red-500' : 
               'border-[#404040] text-[#737373]'
             }`}>
              {deduction.status}
            </span>
          </div>
          <h3 className="font-serif text-xl text-neutral-100 leading-tight">{deduction.title}</h3>
        </div>
        <div className="text-right">
          <div className="text-3xl font-serif text-white">{Math.round(deduction.probability)}%</div>
          <div className="text-[9px] text-[#525252] uppercase tracking-[0.2em] font-medium">Certainty</div>
        </div>
      </div>

      <p className="text-sm text-[#a3a3a3] mb-8 leading-relaxed font-light">
        {deduction.description}
      </p>

      <div className="h-24 w-full mb-8 opacity-60 group-hover:opacity-100 transition-opacity">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={deduction.history}>
            <XAxis dataKey="timestamp" hide />
            <YAxis domain={[0, 100]} hide />
            <Tooltip 
              contentStyle={{ backgroundColor: '#141414', border: '1px solid #262626', fontSize: '10px', color: '#fff' }}
              labelFormatter={() => ''}
            />
            <Line 
              type="monotone" 
              dataKey="value" 
              stroke="#ffffff" 
              strokeWidth={1.5} 
              dot={false}
              animationDuration={1500}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div>
        <h4 className="text-[9px] uppercase font-bold text-[#525252] tracking-[0.3em] mb-4">Supporting Evidence</h4>
        <div className="space-y-3">
          {deduction.evidence.slice(-3).map((e, idx) => (
            <div key={idx} className="text-xs text-[#737373] flex items-start gap-3 group/item">
              <span className="text-[#404040] mt-0.5">/</span>
              <span className="group-hover/item:text-neutral-300 transition-colors">{e}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-8 pt-6 border-t border-[#1a1a1a] flex justify-between items-center text-[9px] text-[#404040] font-mono tracking-widest uppercase">
        <span>REF: {deduction.id.split('-')[0]}</span>
        <span>MODIFIED: {new Date(deduction.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
      </div>
    </div>
  );
};
