import {useEffect,useState} from 'react';
import './DiceTray.css';

const pipMap: Record<number, [number,number][]> = {
  1:[[18,18]], 2:[[9,9],[27,27]], 3:[[9,9],[18,18],[27,27]],
  4:[[9,9],[27,9],[9,27],[27,27]], 5:[[9,9],[27,9],[18,18],[9,27],[27,27]],
  6:[[9,8],[27,8],[9,18],[27,18],[9,28],[27,28]],
};
function Face({value}: {value:number}) { return <svg viewBox="0 0 36 36" aria-label={`${value} pips`} role="img">{pipMap[value].map(([cx,cy],i)=><circle key={i} cx={cx} cy={cy} r="3.2" fill={value===1?'#9E2A2B':'#181715'}/>)}</svg>; }
export default function DiceTray({dice,rolling,speed=1,consecutiveDoubles=0}: {dice:[number,number];rolling:boolean;speed?:1|2;consecutiveDoubles?:number}) {
  const [visual,setVisual]=useState<[number,number]>(dice),[tumbling,setTumbling]=useState(false);
  useEffect(()=>{if(!rolling){setVisual(dice);setTumbling(false);return}setTumbling(true);const tumbleMs=1050/speed,settleMs=420/speed;const timer=window.setInterval(()=>setVisual([1+Math.floor(Math.random()*6),1+Math.floor(Math.random()*6)]),80/speed);const settle=window.setTimeout(()=>setVisual(dice),tumbleMs);const done=window.setTimeout(()=>setTumbling(false),tumbleMs+settleMs);return()=>{window.clearInterval(timer);window.clearTimeout(settle);window.clearTimeout(done)}},[rolling,dice[0],dice[1],speed]);
  const state=consecutiveDoubles>=3?'jail':consecutiveDoubles>0?'doubles':'';
  return <div className={`dice-tray ${state}`}>
    <div className={`physical-die die-left ${tumbling?'tumbling':''}`} style={{'--roll-duration':`${1050/speed}ms`,'--settle-duration':`${420/speed}ms`} as any}><Face value={visual[0]}/></div>
    <div className={`physical-die die-right ${tumbling?'tumbling':''}`} style={{'--roll-duration':`${1050/speed}ms`,'--settle-duration':`${420/speed}ms`} as any}><Face value={visual[1]}/></div>
    <div className="dice-total">TOTAL: {dice[0]+dice[1]}</div>
    {!!consecutiveDoubles&&<div className="doubles-badge">{consecutiveDoubles>=3?'3× DOUBLES · GO TO JAIL':'DOUBLES · ROLL AGAIN'}</div>}
  </div>;
}
