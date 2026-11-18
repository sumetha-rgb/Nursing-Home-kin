"use client";
/**
 * บัญชีรับเงินของบริษัท: ตอนรับชำระ แคชเชียร์เลือกว่าเงินโอนเข้าบัญชีไหน / รูดเครื่อง EDC เครื่องไหน / บัตรเครดิตช่องทางไหน
 *  รายชื่อเก็บในชุดข้อมูล "pay-accounts" (ตาราง pay_accounts) · ผู้มีสิทธิ์ใบแจ้งหนี้และใบเสร็จเพิ่ม/แก้/ปิดใช้ได้
 *  บันทึกในงวดรับชำระเป็นข้อความชื่อบัญชี ณ ตอนรับเงิน (แก้ชื่อภายหลังไม่กระทบประวัติ)
 */
import { useState } from "react";
import { newId, useRecords } from "@/lib/store";
import { useSession } from "@/lib/session";
import { can } from "@/lib/perms";
import { readOnlyRole } from "@/lib/roles";
import { useApp } from "@/lib/app";
import { Field, Modal } from "../ui";

export type PayAccountKind = "transfer" | "edc" | "card";
export type PayAccount = { id: string; branch: string; kind: PayAccountKind; name: string; detail?: string | null; active: boolean; sort?: number | null };
const SHARED = "ทุกสาขา";
const KINDS: PayAccountKind[] = ["transfer", "edc", "card"];
const KIND_TH: Record<PayAccountKind, string> = { transfer: "บัญชีธนาคารรับโอน", edc: "เครื่องรูดบัตร EDC", card: "บัตรเครดิต ช่องทางอื่น (ลิงก์ชำระเงิน ฯลฯ)" };
const KIND_SHORT: Record<PayAccountKind, string> = { transfer: "รับโอน", edc: "เครื่อง EDC", card: "บัตรเครดิตอื่น" };
const CHOICE_LABEL: Record<PayAccountKind, string> = { transfer: "เงินโอนเข้าบัญชี", edc: "รูดเครื่อง EDC", card: "บัตรเครดิตผ่าน" };

/** โลโก้ธนาคาร (public/banks/*.png 200×200 จาก github.com/casperstack/thai-banks-logo) จับจากชื่อบัญชี/เครื่อง */
const BANKS: { re: RegExp; file: string; name: string }[] = [
  { re: /กสิกร|kbank|kasikorn/i, file: "KBANK", name: "กสิกรไทย" },
  { re: /ไทยพาณิชย์|scb/i, file: "SCB", name: "ไทยพาณิชย์" },
  { re: /กรุงเทพ|bbl|bangkok bank/i, file: "BBL", name: "กรุงเทพ" },
  { re: /กรุงไทย|ktb|krungthai/i, file: "KTB", name: "กรุงไทย" },
  { re: /กรุงศรี|\bbay\b|krungsri/i, file: "BAY", name: "กรุงศรีอยุธยา" },
  { re: /ทีทีบี|ttb|ทหารไทย|ธนชาต/i, file: "TTB", name: "ทีทีบี" },
  { re: /ออมสิน|gsb/i, file: "GSB", name: "ออมสิน" },
  { re: /ยูโอบี|uob/i, file: "UOB", name: "ยูโอบี" },
  { re: /ซีไอเอ็มบี|cimb/i, file: "CIMB", name: "ซีไอเอ็มบี" },
  { re: /เกียรตินาคิน|kkp/i, file: "KKP", name: "เกียรตินาคินภัทร" },
  { re: /ธ\.?ก\.?ส|baac/i, file: "BAAC", name: "ธ.ก.ส." },
  { re: /อาคารสงเคราะห์|ธอส|ghb/i, file: "GHB", name: "อาคารสงเคราะห์" },
  { re: /ทิสโก้|tisco/i, file: "TISCO", name: "ทิสโก้" },
  { re: /แลนด์|lh bank|lhb/i, file: "LHB", name: "แลนด์ แอนด์ เฮ้าส์" },
];
export const bankOf = (text: string) => BANKS.find((b) => b.re.test(text)) ?? null;

export function BankIcon({ text, kind, size = 28 }: { text: string; kind: PayAccountKind; size?: number }) {
  const b = bankOf(text);
  const box = { width: size, height: size, borderRadius: size * 0.28, flex: "none" as const };
  // eslint-disable-next-line @next/next/no-img-element
  if (b) return <img src={`/banks/${b.file}.png`} alt="" title={b.name} width={size} height={size} style={{ ...box, objectFit: "contain" }} />;
  // ไม่รู้ธนาคาร: ไอคอนตามประเภท (ธนาคาร / เครื่องรูดบัตร / บัตร)
  return <span aria-hidden="true" style={{ ...box, background: "#f3ead7", color: "#8a6a2c", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
    <svg viewBox="0 0 24 24" width={size * 0.6} height={size * 0.6} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      {kind === "transfer" ? <><path d="M3 10h18L12 4z" /><path d="M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 20h18" /></>
        : kind === "edc" ? <><rect x="6" y="2.5" width="12" height="19" rx="2" /><rect x="8.5" y="5" width="7" height="4" rx="0.8" /><path d="M9 13h.01M12 13h.01M15 13h.01M9 16h.01M12 16h.01M15 16h.01" /></>
        : <><rect x="2.5" y="5" width="19" height="14" rx="2" /><path d="M2.5 10h19M6 15h4" /></>}
    </svg>
  </span>;
}

/** ข้อความที่บันทึกในงวดรับชำระ เช่น "กสิกรไทย 047-1-4-7576-9" */
export const accountLabel = (a: PayAccount) => [a.name.trim(), (a.detail ?? "").trim()].filter(Boolean).join(" ");

const byOrder = (a: PayAccount, b: PayAccount) => (a.sort ?? 0) - (b.sort ?? 0) || a.name.localeCompare(b.name, "th");

export function usePayAccounts() {
  return useRecords<PayAccount>("pay-accounts", []);
}

/** ปุ่มเลือกบัญชี (ไม่เลือกให้ล่วงหน้า) · branch = สาขาของใบ ใช้กรองบัญชีเฉพาะสาขา (บัญชีทุกสาขาแสดงเสมอ)
 *  เพิ่ม/แก้/ปิดใช้บัญชีอยู่ที่เมนู "ตั้งค่า" › บัญชีธนาคาร (แยกจากหน้ารับชำระ) */
export function AccountChoice({ kind, value, onChange, branch }: { kind: PayAccountKind; value: string; onChange: (v: string) => void; branch?: string }) {
  const [list, , meta] = usePayAccounts();
  const opts = list.filter((a) => a.kind === kind && a.active && (!branch || a.branch === SHARED || a.branch === branch)).sort(byOrder);
  const label = CHOICE_LABEL[kind];
  return (
    <div role="group" aria-label={label}>
      <div className="label">{label}<span className="ml-1 text-red-500">*</span></div>
      <div role="radiogroup" aria-label={label} className="acct-cards">
        {opts.map((a) => {
          const t = accountLabel(a), on = value === t;
          return <button key={a.id} type="button" role="radio" aria-checked={on} className={`acct-card ${on ? "is-on" : ""}`} onClick={() => onChange(on ? "" : t)}>
            <BankIcon text={a.name} kind={a.kind} />
            <span className="acct-text"><b>{a.name}</b>{(a.detail || (a.branch !== SHARED && !branch)) && <small>{[a.detail, a.branch !== SHARED && !branch ? a.branch : ""].filter(Boolean).join(" · ")}</small>}</span>
          </button>;
        })}
        {!opts.length && <span className="text-sm text-gold-600">{meta.loaded ? `ยังไม่มี${KIND_TH[kind]} · เพิ่มได้ที่เมนู ตั้งค่า › บัญชีธนาคาร` : "กำลังโหลดรายชื่อบัญชี…"}</span>}
      </div>
      {value && !opts.some((a) => accountLabel(a) === value) && <p className="field-hint mt-1">เลือกไว้: {value}</p>}
    </div>
  );
}

type Draft = { id: string; kind: PayAccountKind; name: string; detail: string; branch: string };
const PH: Record<PayAccountKind, [string, string, string, string]> = {
  transfer: ["ธนาคาร", "เช่น กสิกรไทย", "เลขบัญชี", "เช่น 047-1-4-7576-9"],
  edc: ["ชื่อเครื่อง EDC", "เช่น EDC กสิกรไทย สุขุมวิท 107", "เลขเครื่อง (TID)", "เช่น TID 70418823"],
  card: ["ช่องทาง", "เช่น บัตรเครดิต (ลิงก์ชำระเงิน)", "รายละเอียด (ถ้ามี)", ""],
};
const ADD_LABEL: Record<PayAccountKind, string> = { transfer: "เพิ่มบัญชีธนาคาร", edc: "เพิ่มเครื่อง EDC", card: "เพิ่มช่องทางบัตร" };

/**
 * หน้า "ตั้งค่าบัญชีธนาคาร": แยกเป็น 3 หมวด (บัญชีรับโอน · เครื่อง EDC · บัตรเครดิตช่องทางอื่น)
 *  สวิตช์เปิด/ปิดใช้งาน (ปิดแล้วไม่ขึ้นให้เลือกตอนรับชำระ · ไม่ลบ เพื่อให้ประวัติอ่านออก) · เพิ่ม/แก้ไขในหน้าต่าง
 */
export function PayAccountsManager() {
  const [list, setList, meta] = usePayAccounts();
  const { user } = useSession();
  const { toast } = useApp();
  const global = user?.role === "Global Admin";
  const myBranch = global ? SHARED : user?.branch || SHARED;
  const [f, setF] = useState<Draft | null>(null);
  const [err, setErr] = useState("");
  // แก้ได้: บัญชีของสาขาตัวเอง + บัญชีกลาง (ทุกสาขา) · ผู้บริหารแก้ได้ทุกบัญชี
  const editable = (a: PayAccount) => can(user, "billing") && !readOnlyRole(user?.role) && (global || a.branch === user?.branch || a.branch === SHARED);
  const open = (kind: PayAccountKind, a?: PayAccount) => { setErr(""); setF(a ? { id: a.id, kind: a.kind, name: a.name, detail: a.detail ?? "", branch: a.branch } : { id: "", kind, name: "", detail: "", branch: myBranch }); };
  const save = () => {
    if (!f) return;
    const name = f.name.replace(/\s+/g, " ").trim();
    if (!name) return setErr(`กรุณาใส่${PH[f.kind][0]}`);
    const old = list.find((a) => a.id === f.id);
    const row: PayAccount = { id: f.id || newId(), kind: f.kind, name, detail: f.detail.trim() || null, branch: global ? f.branch.trim() || SHARED : old?.branch ?? myBranch, active: old?.active ?? true, sort: old?.sort ?? null };
    setList(old ? list.map((a) => (a.id === row.id ? row : a)) : [...list, row]);
    toast(old ? `บันทึกแล้ว · ${accountLabel(row)}` : `เพิ่มแล้ว · ${accountLabel(row)}`);
    setF(null);
  };
  const toggle = (a: PayAccount) => { setList(list.map((x) => (x.id === a.id ? { ...a, active: !a.active } : x))); toast(`${a.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}แล้ว · ${a.name}`); };
  // เปิดใช้อยู่ขึ้นก่อน · ในกลุ่มเดียวกันเรียงตามลำดับที่เพิ่ม
  const sorted = (k: PayAccountKind) => list.filter((a) => a.kind === k).sort((a, b) => Number(b.active) - Number(a.active) || byOrder(a, b));
  return (
    <div className="grid gap-5">
      {KINDS.map((k) => {
        const rows = sorted(k), on = rows.filter((a) => a.active).length;
        return (
          <section key={k} className="card section-surface">
            <div className="section-heading">
              <div><h2>{KIND_TH[k]}</h2><p>{rows.length ? `เปิดใช้งาน ${on} จาก ${rows.length} รายการ · ที่ปิดไว้จะไม่ขึ้นให้เลือกตอนรับชำระ` : "ยังไม่มีรายการ"}</p></div>
              {can(user, "billing") && <div className="section-actions"><button type="button" className="btn-soft" onClick={() => open(k)}>+ {ADD_LABEL[k]}</button></div>}
            </div>
            <ul className="acct-list">
              {rows.map((a) => (
                <li key={a.id} className={a.active ? "" : "is-off"}>
                  <BankIcon text={a.name} kind={a.kind} size={40} />
                  <span className="acct-list-t"><b>{a.name}</b>{a.detail ? <span>{a.detail}</span> : a.kind !== "card" ? <span><i>ยังไม่ใส่{PH[a.kind][2]}</i></span> : null}<small>{a.branch}</small></span>
                  <button type="button" role="switch" aria-checked={a.active} aria-label={`${accountLabel(a)} ${a.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}`} className="pl-switch"
                    disabled={!editable(a)} title={editable(a) ? (a.active ? "กดเพื่อปิดใช้งาน" : "กดเพื่อเปิดใช้งาน") : "แก้ได้เฉพาะบัญชีของสาขาตัวเองและบัญชีกลาง"} onClick={() => toggle(a)}>
                    <i aria-hidden="true" /><span>{a.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}</span>
                  </button>
                  {editable(a) ? <button type="button" className="row-action" onClick={() => open(a.kind, a)}>แก้ไข</button> : <span />}
                </li>
              ))}
              {!rows.length && <li className="acct-empty">{meta.loaded ? `ยังไม่มี${KIND_TH[k]}` : "กำลังโหลด…"}</li>}
            </ul>
          </section>
        );
      })}
      <Modal open={!!f} title={f?.id ? `แก้ไข ${list.find((a) => a.id === f.id)?.name ?? ""}` : f ? ADD_LABEL[f.kind] : ""} onClose={() => setF(null)}
        footer={<><button type="button" className="btn-soft" onClick={() => setF(null)}>ยกเลิก</button><button type="button" className="btn-primary" onClick={save}>{f?.id ? "บันทึกการแก้ไข" : "เพิ่ม"}</button></>}>
        {f && <div className="grid gap-4">
          <Field label="ประเภท">
            <div role="radiogroup" aria-label="ประเภท" className="pay-cards">
              {KINDS.map((k) => <button key={k} type="button" role="radio" aria-checked={f.kind === k} className={`pay-card ${f.kind === k ? "is-on" : ""}`} onClick={() => setF({ ...f, kind: k })}>{KIND_SHORT[k]}</button>)}
            </div>
          </Field>
          <Field label={PH[f.kind][0]} required>
            <div className="flex items-center gap-3"><BankIcon text={f.name} kind={f.kind} size={40} /><input autoFocus={!f.id} value={f.name} maxLength={50} placeholder={PH[f.kind][1]} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          </Field>
          <Field label={PH[f.kind][2]}><input id="pay-acct-detail" autoFocus={!!f.id} value={f.detail} maxLength={40} placeholder={PH[f.kind][3]} onChange={(e) => setF({ ...f, detail: e.target.value })} /></Field>
          {global && <Field label="ใช้ที่สาขา"><input value={f.branch} placeholder={SHARED} onChange={(e) => setF({ ...f, branch: e.target.value })} /><p className="field-hint">ใส่ &quot;ทุกสาขา&quot; หรือชื่อสาขา เช่น สุขุมวิท 107</p></Field>}
          <p className="field-hint">โลโก้ธนาคารขึ้นเองจากชื่อ เช่น กสิกร · ไทยพาณิชย์ · กรุงเทพ · กรุงไทย · กรุงศรี · ttb · ออมสิน · UOB · CIMB</p>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>}
      </Modal>
    </div>
  );
}
