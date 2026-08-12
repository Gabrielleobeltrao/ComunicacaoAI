import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router'
import './index.css'
import { OfficeFloor } from './office/OfficeFloor'
import type { AgentSummary, SectorSummary } from './lib/types'

const NAMES = ['Ana','Bruno','Caio','Duda','Enzo','Fabio','Gil','Hugo','Iris','Joao','Kiara','Lia','Mel','Nina','Otto','Pedro','Rafa','Sofia','Teo','Vera','Yara','Zeca','Bia','Caetano','Dora','Elis']
let uid=0
const mk=(n:number):AgentSummary[]=>Array.from({length:n},()=>({_id:`a-${uid}`,name:NAMES[uid++%NAMES.length]} as unknown as AgentSummary))
const rh=mk(1),fin=mk(2),dev=mk(4),mkt=mk(2),ven=mk(3),sup=mk(3),loose=mk(8)
const agents=[...rh,...fin,...dev,...mkt,...ven,...sup,...loose]
const sec=(id:string,name:string,color:string,as:AgentSummary[]):SectorSummary=>({_id:id,name,color,members:as.map(a=>({agentId:a._id}))} as unknown as SectorSummary)
const sectors=[sec('rh','RH','#FF6A5B',rh),sec('fin','Financeiro','#17B98A',fin),sec('dev','Desenvolvimento','#2E5BFF',dev),sec('mkt','Marketing','#FFB53D',mkt),sec('ven','Vendas','#8B5CF6',ven),sec('sup','Suporte','#38B6F0',sup)]

createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <div style={{padding:20,background:'#F4EEE1',minHeight:'100vh'}}>
      <div style={{maxWidth:1200,margin:'0 auto'}}>
        <div style={{font:'700 12px system-ui',letterSpacing:'.08em',color:'#8a7a5c',marginBottom:8}}>SUA EQUIPE (preview)</div>
        <OfficeFloor agents={agents} sectors={sectors} />
      </div>
    </div>
  </MemoryRouter>,
)
