import type { Config } from "tailwindcss";
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: { extend: {
    colors: {
      cream: {50:"#FFFDFA",100:"#F7F3EA",200:"#EDE5D6",300:"#DED3BF"},
      gold: {100:"#F4EBD7",200:"#E8D8B7",300:"#CDB78B",400:"#A58E65",500:"#82725A",600:"#786443",700:"#8B6E3E",800:"#4A4032",900:"#302B24"},
      plum: {50:"#FAF7F0",100:"#F2E9D6",500:"#AC9160",700:"#8B6E3E",900:"#302B24"},
      copper: "#B89560",
    },
    fontFamily: {sans:["var(--font-thai)","Tahoma","sans-serif"]},
    fontSize: {xs:["0.8125rem",{lineHeight:"1.65"}],sm:["0.9375rem",{lineHeight:"1.75"}],base:["1rem",{lineHeight:"1.8"}]},
    boxShadow: {soft:"0 4px 24px -12px rgba(46,32,57,.10)"},
  }}, plugins:[],
};
export default config;
