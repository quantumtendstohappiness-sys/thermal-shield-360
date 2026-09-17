const $ = id => document.getElementById(id);

function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
function cToF(c){return c*9/5+32;}
function fToC(f){return (f-32)*5/9;}

/* NOAA/NWS Rothfusz heat-index implementation.
   The official NWS equation is in °F and has a validity range. */
function heatIndexC(Tc,RH){
  const T=cToF(Tc);
  if(!Number.isFinite(T)||!Number.isFinite(RH)) return NaN;
  const simple=0.5*(T+61+((T-68)*1.2)+(RH*0.094));
  if(simple<80) return fToC(simple);
  let hi=-42.379+2.04901523*T+10.14333127*RH-0.22475541*T*RH
    -0.00683783*T*T-0.05481717*RH*RH
    +0.00122874*T*T*RH+0.00085282*T*RH*RH
    -0.00000199*T*T*RH*RH;
  if(RH<13 && T>=80 && T<=112){
    hi -= ((13-RH)/4)*Math.sqrt((17-Math.abs(T-95))/17);
  }else if(RH>85 && T>=80 && T<=87){
    hi += ((RH-85)/10)*((87-T)/5);
  }
  return fToC(hi);
}

/* Stull (2011) wet-bulb approximation from T and RH.
   Used only to build a prototype WBGT proxy. */
function wetBulbStull(T,RH){
  const rh=clamp(RH,5,99);
  return T*Math.atan(0.151977*Math.sqrt(rh+8.313659))
    +Math.atan(T+rh)-Math.atan(rh-1.676331)
    +0.00391838*Math.pow(rh,1.5)*Math.atan(0.023101*rh)-4.686035;
}

/* IMPORTANT: this is NOT official ISO WBGT.
   With no measured globe temperature, we use a transparent screening proxy.
   The proxy's globe term is deliberately displayed as an assumption. */
function wbgtProxy(T,RH,wind,rad){
  const tw=wetBulbStull(T,RH);
  const globeProxy=T + 0.20*Math.sqrt(Math.max(0,rad)) - 0.7*Math.min(wind,10);
  return 0.7*tw + 0.2*globeProxy + 0.1*T;
}

function normalize(value,low,high){
  return clamp((value-low)/(high-low),0,1);
}

function calcHTSI({T,RH,wind,rad,utci,persistence,downside}){
  const hi=heatIndexC(T,RH);
  const wbgt=wbgtProxy(T,RH,wind,rad);

  // Screening normalization ranges. Replace these with Indian historical
  // baseline percentiles after calibration; they are NOT medical thresholds.
  const nHI=normalize(hi,27,50);
  const nWBGT=normalize(wbgt,20,40);

  // UTCI is optional. If unavailable, the UI renormalizes the available
  // weights rather than inventing a UTCI value.
  const hasUTCI=Number.isFinite(utci);
  const weights={utci:0.30,wbgt:0.25,hi:0.15,persistence:0.10,radwind:0.10,downside:0.10};
  let sum=0, wsum=0;
  if(hasUTCI){sum+=weights.utci*normalize(utci,20,50);wsum+=weights.utci;}
  sum+=weights.wbgt*nWBGT; wsum+=weights.wbgt;
  sum+=weights.hi*nHI; wsum+=weights.hi;
  sum+=weights.persistence*clamp(persistence,0,1); wsum+=weights.persistence;
  const radStress=clamp((rad/800),0,1)*0.65 + (1-clamp(wind/4,0,1))*0.35;
  sum+=weights.radwind*radStress; wsum+=weights.radwind;
  sum+=weights.downside*clamp(downside,0,1); wsum+=weights.downside;

  return {htsi:100*sum/wsum,hi,wbgt, nHI,nWBGT,radStress,hasUTCI};
}

async function loadWeather(){
  const lat=parseFloat($("lat").value),lon=parseFloat($("lon").value);
  if(!Number.isFinite(lat)||!Number.isFinite(lon)){ $("status").textContent="Enter valid latitude/longitude.";return; }
  $("status").textContent="Loading Open-Meteo forecast…";
  const url=`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,relative_humidity_2m,wind_speed_10m,shortwave_radiation,wet_bulb_temperature_2m&forecast_days=3&timezone=auto`;
  try{
    const r=await fetch(url); if(!r.ok) throw new Error(`HTTP ${r.status}`);
    const d=await r.json();
    const i=d.hourly.time.findIndex(t=>new Date(t)>=new Date());
    const idx=i>=0?i:0;
    $("temp").value=d.hourly.temperature_2m[idx];
    $("rh").value=d.hourly.relative_humidity_2m[idx];
    $("wind").value=(d.hourly.wind_speed_10m[idx]/3.6).toFixed(2);
    $("rad").value=Math.round(d.hourly.shortwave_radiation[idx]||0);
    $("status").textContent=`Loaded ${d.hourly.time[idx]} (${d.timezone}). Source: Open-Meteo forecast.`;
    calculate();
  }catch(e){$("status").textContent=`Weather load failed: ${e.message}`;}
}

function calculate(){
  const args={
    T:parseFloat($("temp").value),RH:parseFloat($("rh").value),
    wind:parseFloat($("wind").value),rad:parseFloat($("rad").value),
    utci:parseFloat($("utci").value),persistence:parseFloat($("persistence").value)||0,
    downside:parseFloat($("downside").value)||0
  };
  if(![args.T,args.RH,args.wind,args.rad].every(Number.isFinite)){
    $("risk").textContent="Enter environmental inputs";return;
  }
  const r=calcHTSI(args);
  const s=Math.round(r.htsi);
  $("score").textContent=s;
  $("risk").textContent=s<25?"Low thermal-stress signal":s<50?"Moderate thermal-stress signal":s<75?"High thermal-stress signal":"Very high thermal-stress signal";
  $("explain").textContent="HTSI is a transparent research prototype. It is not a medical diagnosis or an official warning product.";
  $("hi").textContent=`${r.hi.toFixed(1)} °C`;
  $("wbgt").textContent=`${r.wbgt.toFixed(1)} °C (proxy)`;
  $("utciOut").textContent=Number.isFinite(args.utci)?`${args.utci.toFixed(1)} °C`:"not supplied";
  $("persistOut").textContent=args.persistence.toFixed(2);
  $("radOut").textContent=r.radStress.toFixed(2);
  $("downOut").textContent=args.downside.toFixed(2);
  $("formula").textContent=
`HTSI v0.1 (from Thermal Shield 360 research blueprint)
= 0.30*N(UTCI) + 0.25*N(WBGT) + 0.15*N(HI)
  + 0.10*Persistence + 0.10*Radiation/low-wind stress
  + 0.10*Forecast downside

For this MVP, if UTCI is missing its weight is removed and the
remaining weights are renormalized. Screening normalization ranges
are placeholders for calibration against Indian historical data.
Do not present them as medical thresholds.`;
  $("sourceLog").textContent=
`Weather: Open-Meteo forecast variables (T2m, RH2m, wind10m, shortwave radiation).
Heat Index: NOAA/NWS Rothfusz regression.
WBGT: proxy only because measured globe temperature is unavailable.
ENSO: local data/enso.json, based on NOAA CPC official discussion.
HTSI weights: Thermal Shield 360 research blueprint; must be calibrated.`;
}

async function loadENSO(){
  try{
    const r=await fetch("data/enso.json"); const d=await r.json();
    $("ensoBox").innerHTML=`<b>${d.source}</b><br>${d.date} — ${d.status}<br>Niño-3.4 anomaly: ${d.nino34_anomaly_c} °C<br>Very-strong event probability: ${d.very_strong_event_probability_text}<br><small>${d.note}</small>`;
  }catch(e){$("ensoBox").textContent="ENSO evidence file could not be loaded.";}
}
$("loadBtn").addEventListener("click",loadWeather);
$("calcBtn").addEventListener("click",calculate);
loadENSO();
