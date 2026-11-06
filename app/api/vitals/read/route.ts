import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { currentUser, unauthorized } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const fetchCache = "force-no-store";
export const maxDuration = 60;

/**
 * อ่านค่าสัญญาณชีพจากรูปหน้าจอเครื่องวัด (เครื่องวัดความดัน ออกซิเจนปลายนิ้ว ปรอท เครื่องตรวจน้ำตาล ตาชั่ง)
 *  GET              { enabled } = ตั้ง ANTHROPIC_API_KEY ไว้หรือยัง (ไม่ตั้ง = ซ่อนปุ่มในหน้าบันทึกสัญญาณชีพ)
 *  POST { image }   data URL JPEG/PNG (ย่อแล้วจากเครื่อง ไม่เกิน ~1.5MB) → ค่าที่อ่านได้ · ไม่เก็บรูป
 * ผลลัพธ์เป็นค่าตั้งต้นให้พยาบาลตรวจกับหน้าจอเครื่องก่อนกดบันทึกเองเสมอ
 */
// อ่านตัวเลขบนหน้าจอเป็นงานง่าย ใช้รุ่นราคาถูก (Haiku 5.5 ไม่มีโมเดลสำรองฝั่งเซิร์ฟเวอร์เมื่อถูกปฏิเสธ → แจ้งให้กรอกเอง)
const MODEL = "claude-haiku-5-5";
const MAX = 2_000_000;
const num = { type: ["number", "null"] } as const;
const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["readable", "device", "bp_sys", "bp_dia", "pulse", "spo2", "temp_c", "glucose_mg_dl", "weight_kg", "note"],
  properties: {
    readable: { type: "boolean", description: "true if at least one value is clearly readable on the device display" },
    device: { type: "string", description: "kind of device, e.g. blood pressure monitor, pulse oximeter, thermometer, glucometer, scale, unknown" },
    bp_sys: num, bp_dia: num, pulse: num, spo2: num, temp_c: num, glucose_mg_dl: num, weight_kg: num,
    note: { type: "string", description: "short Thai note about anything uncertain (blurry digit, unit not shown); empty if none" },
  },
};
const PROMPT = `This is a photo of a medical device display taken by a nurse at a nursing home.
Read the numbers shown on the display and map them to the fields.
- Blood pressure monitors show SYS / DIA (mmHg) and usually PULSE (/min).
- Pulse oximeters show SpO2 (%) and pulse rate (PR, bpm).
- Thermometers show body temperature; convert °F to °C if the unit is °F.
- Glucometers show blood glucose; convert mmol/L to mg/dL (× 18) if the unit is mmol/L.
- Scales show body weight in kg.
Use null for any value that is not clearly visible. Never guess a digit you cannot read; mention it in note instead (in Thai).
Ignore stored-memory/average readings, dates and clock times.`;

export async function GET(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  return NextResponse.json({ enabled: !!process.env.ANTHROPIC_API_KEY });
}

export async function POST(req: NextRequest) {
  const me = await currentUser(req);
  if (!me) return unauthorized();
  if (!process.env.ANTHROPIC_API_KEY) return NextResponse.json({ error: "ยังไม่ได้ตั้งค่าการอ่านค่าจากรูป" }, { status: 503 });
  const b = await req.json().catch(() => ({}));
  const m = typeof b.image === "string" ? b.image.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/) : null;
  if (!m) return NextResponse.json({ error: "ไฟล์รูปไม่ถูกต้อง" }, { status: 400 });
  if (m[2].length > MAX) return NextResponse.json({ error: "รูปใหญ่เกินไป" }, { status: 413 });

  const client = new Anthropic();
  try {
    const res = await client.messages.create({
      model: MODEL,
      max_tokens: 4000,
      output_config: { effort: "low", format: { type: "json_schema", schema: SCHEMA } },
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: m[1] as "image/jpeg" | "image/png" | "image/webp", data: m[2] } },
          { type: "text", text: PROMPT },
        ],
      }],
    });
    if (res.stop_reason === "refusal") return NextResponse.json({ error: "อ่านรูปนี้ไม่ได้ · กรอกค่าเองแทน" }, { status: 422 });
    const text = res.content.find((x) => x.type === "text");
    const data = text && text.type === "text" ? JSON.parse(text.text) : null;
    if (!data) return NextResponse.json({ error: "อ่านค่าไม่สำเร็จ · กรอกค่าเองแทน" }, { status: 422 });
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return NextResponse.json({ error: "มีคนใช้งานพร้อมกันมาก · ลองใหม่อีกครั้ง" }, { status: 429 });
    if (e instanceof Anthropic.APIError) { console.error("[vitals/read]", e.status, e.message); return NextResponse.json({ error: "บริการอ่านรูปไม่พร้อม · กรอกค่าเองแทน" }, { status: 502 }); }
    console.error("[vitals/read]", e);
    return NextResponse.json({ error: "อ่านค่าไม่สำเร็จ · กรอกค่าเองแทน" }, { status: 500 });
  }
}
