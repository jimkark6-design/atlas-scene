"use client";

import { ChangeEvent, useEffect, useState } from "react";
import { ArrowLeft, Check, Upload } from "lucide-react";

type BusinessProfile = {
  name: string; category: string; description: string; location: string;
  website: string; instagram: string; tiktok: string; phone: string;
  services: string; offers: string; usp: string; audience: string;
  personality: string; primary_color: string; secondary_color: string;
  font_family: string; logo_url: string; logo_data_url: string;
};

const defaultBusinessProfile: BusinessProfile = {
  name:"", category:"", description:"", location:"", website:"", instagram:"", tiktok:"", phone:"",
  services:"", offers:"", usp:"", audience:"", personality:"Premium · Clean",
  primary_color:"#c9ff4a", secondary_color:"#ffffff", font_family:"Inter", logo_url:"", logo_data_url:""
};

const inputStyle: React.CSSProperties = {
  width:"100%", boxSizing:"border-box", background:"#0d1010", border:"1px solid #252a27",
  color:"#eef3e8", borderRadius:9, padding:"10px 11px", outline:"none", fontSize:12
};

export default function BusinessPage(){
  const [profile,setProfile]=useState<BusinessProfile>(defaultBusinessProfile);
  const [saved,setSaved]=useState(false);

  useEffect(()=>{
    const raw=window.localStorage.getItem("atlasBusinessProfile");
    if(raw){ try{ setProfile({...defaultBusinessProfile,...JSON.parse(raw)}); }catch{} }
  },[]);

  const update=(patch:Partial<BusinessProfile>)=>{
    setProfile(p=>({...p,...patch}));
    setSaved(false);
  };

  const save=()=>{
    window.localStorage.setItem("atlasBusinessProfile",JSON.stringify(profile));
    setSaved(true);
  };

  const uploadLogo=(e:ChangeEvent<HTMLInputElement>)=>{
    const file=e.target.files?.[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=()=>update({logo_data_url:String(reader.result||"")});
    reader.readAsDataURL(file);
  };

  return <main style={{minHeight:"100vh",background:"#050706",color:"#eef3e8",fontFamily:"Inter,Arial,sans-serif",padding:"32px 20px"}}>
    <div style={{maxWidth:900,margin:"0 auto"}}>
      <button onClick={()=>window.location.href="/reel"} style={{background:"transparent",border:0,color:"#8f9a89",display:"flex",alignItems:"center",gap:7,cursor:"pointer",fontSize:12,marginBottom:20}}><ArrowLeft size={15}/> Back to Reel</button>
      <div style={{border:"1px solid #202522",borderRadius:18,padding:26,background:"linear-gradient(135deg,#0b0f0c,#080a09)"}}>
        <div style={{fontSize:10,letterSpacing:2,color:"#a9b59f",fontWeight:700}}>ATLAS BUSINESS PROFILE</div>
        <h1 style={{fontSize:34,lineHeight:1,margin:"10px 0 8px",letterSpacing:-1.5}}>Know the business.<br/><span style={{color:"#c9ff4a"}}>Use it everywhere.</span></h1>
        <p style={{fontSize:12,color:"#7f8b7c",maxWidth:620,lineHeight:1.6}}>Set this once. Every Reel brief can automatically use the same business identity, brand details, services, audience, location and logo.</p>

        <section style={{marginTop:26,border:"1px solid rgba(180,255,80,.16)",borderRadius:14,padding:16,background:"rgba(180,255,80,.025)"}}>
          <div style={{fontSize:10,letterSpacing:1.5,color:"#a9b59f",fontWeight:700,marginBottom:12}}>IDENTITY</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <input style={inputStyle} value={profile.name} onChange={e=>update({name:e.target.value})} placeholder="Business name" />
            <input style={inputStyle} value={profile.category} onChange={e=>update({category:e.target.value})} placeholder="Business type / category" />
            <input style={inputStyle} value={profile.location} onChange={e=>update({location:e.target.value})} placeholder="Location / city" />
            <input style={inputStyle} value={profile.phone} onChange={e=>update({phone:e.target.value})} placeholder="Phone (optional)" />
            <input style={inputStyle} value={profile.website} onChange={e=>update({website:e.target.value})} placeholder="Website" />
            <input style={inputStyle} value={profile.instagram} onChange={e=>update({instagram:e.target.value})} placeholder="Instagram" />
            <input style={inputStyle} value={profile.tiktok} onChange={e=>update({tiktok:e.target.value})} placeholder="TikTok" />
          </div>
        </section>

        <section style={{marginTop:12,border:"1px solid #202522",borderRadius:14,padding:16,background:"#090c0a"}}>
          <div style={{fontSize:10,letterSpacing:1.5,color:"#a9b59f",fontWeight:700,marginBottom:12}}>BUSINESS KNOWLEDGE</div>
          <div style={{display:"grid",gap:10}}>
            <textarea style={{...inputStyle,resize:"vertical"}} rows={3} value={profile.description} onChange={e=>update({description:e.target.value})} placeholder="What does the business do?" />
            <textarea style={{...inputStyle,resize:"vertical"}} rows={3} value={profile.services} onChange={e=>update({services:e.target.value})} placeholder="Main services / products" />
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              <textarea style={{...inputStyle,resize:"vertical"}} rows={2} value={profile.offers} onChange={e=>update({offers:e.target.value})} placeholder="Offers / prices" />
              <textarea style={{...inputStyle,resize:"vertical"}} rows={2} value={profile.usp} onChange={e=>update({usp:e.target.value})} placeholder="What makes this business different?" />
            </div>
            <input style={inputStyle} value={profile.audience} onChange={e=>update({audience:e.target.value})} placeholder="Typical customer / target audience" />
          </div>
        </section>

        <section style={{marginTop:12,border:"1px solid #202522",borderRadius:14,padding:16,background:"#090c0a"}}>
          <div style={{fontSize:10,letterSpacing:1.5,color:"#a9b59f",fontWeight:700,marginBottom:12}}>BRAND SYSTEM</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <select style={inputStyle} value={profile.personality} onChange={e=>update({personality:e.target.value})}><option>Premium · Clean</option><option>Luxury · Minimal</option><option>Bold · Energetic</option><option>Friendly · Local</option><option>Authentic · UGC</option><option>Playful · Social</option></select>
            <input style={inputStyle} value={profile.font_family} onChange={e=>update({font_family:e.target.value})} placeholder="Brand font" />
            <label style={{...inputStyle,display:"flex",alignItems:"center",gap:10}}>Primary color<input type="color" value={profile.primary_color} onChange={e=>update({primary_color:e.target.value})} style={{marginLeft:"auto",width:50,height:28}} /></label>
            <label style={{...inputStyle,display:"flex",alignItems:"center",gap:10}}>Secondary color<input type="color" value={profile.secondary_color} onChange={e=>update({secondary_color:e.target.value})} style={{marginLeft:"auto",width:50,height:28}} /></label>
            <input style={inputStyle} value={profile.logo_url} onChange={e=>update({logo_url:e.target.value})} placeholder="Logo URL" />
            <label style={{...inputStyle,cursor:"pointer",display:"flex",alignItems:"center",gap:8}}><Upload size={14}/> {profile.logo_data_url?"Logo uploaded":"Upload logo"}<input hidden type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" onChange={uploadLogo}/></label>
          </div>
          {profile.logo_data_url && <div style={{marginTop:12,display:"flex",alignItems:"center",gap:12}}><img src={profile.logo_data_url} alt="Logo" style={{width:54,height:54,objectFit:"contain",borderRadius:10,border:"1px solid #252a27",background:"#111412"}}/><span style={{fontSize:11,color:"#7f8b7c"}}>This logo will be available to the Reel pipeline.</span></div>}
        </section>

        <button onClick={save} style={{marginTop:18,width:"100%",border:0,borderRadius:10,padding:"13px 16px",background:"#c9ff4a",color:"#10130d",fontWeight:800,cursor:"pointer",display:"flex",justifyContent:"center",alignItems:"center",gap:8}}>{saved?<><Check size={16}/> Business profile saved</>:<>Save business profile</>}</button>
      </div>
    </div>
  </main>;
}
