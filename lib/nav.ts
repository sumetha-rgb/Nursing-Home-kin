export type ViewId = "careplan"|"contracts"|"residents"|"tasks_table"|"tasks"|"appointments"|"health_logs"|"feedbacks"|"dashboard"|"official-docs"|"branches"|"staff"|"facility_tasks"|"master_tasks"|"quotations"|"audit"|"roster"|"reviews"|"kpi"|"tutorials"|"rooms"|"billing"|"prices"|"exports";
/** กลุ่มเมนู: 4 บริหาร · 0 งานดูแล · 1 ขายและการเงิน · 3 ทีมงาน · 2 เครื่องมือและระบบ (ลำดับที่แสดงอยู่ที่ GROUPS ใน Shell.tsx) */
export type NavGroup = 0|1|2|3|4;
export type NavItem = {kind:"view";id:ViewId;label:string;icon:string;group:NavGroup}|{kind:"link";href:string;label:string;icon:string;group:NavGroup;perm:"app.staff"|"app.pharmacy"};
export const NAV:NavItem[]=[
{kind:"view",id:"dashboard",label:"ภาพรวมและรายงาน",icon:"chart",group:4},
{kind:"view",id:"branches",label:"ข้อมูลสาขา",icon:"building",group:4},
{kind:"view",id:"exports",label:"ส่งออกข้อมูล",icon:"download",group:4},
{kind:"view",id:"careplan",label:"งานวันนี้",icon:"grid",group:0},
{kind:"view",id:"residents",label:"ผู้รับบริการ",icon:"user",group:0},
{kind:"view",id:"rooms",label:"ห้องพักและเตียง",icon:"bed",group:0},
{kind:"view",id:"tasks",label:"มอบหมายและตรวจงาน",icon:"check",group:0},
{kind:"view",id:"roster",label:"ตารางเวร",icon:"clock",group:0},
{kind:"view",id:"appointments",label:"ตารางนัดหมาย",icon:"calendar",group:0},
{kind:"view",id:"health_logs",label:"บันทึกสุขภาพ",icon:"heart",group:0},
{kind:"view",id:"feedbacks",label:"เสียงจากครอบครัว",icon:"chat",group:0},
{kind:"view",id:"prices",label:"ราคาสินค้าและบริการ",icon:"tag",group:1},
{kind:"view",id:"quotations",label:"ใบเสนอราคา / แผนดูแล",icon:"flow",group:1},
{kind:"view",id:"contracts",label:"สัญญาบริการ",icon:"doc",group:1},
{kind:"view",id:"billing",label:"ใบแจ้งหนี้และใบเสร็จ",icon:"receipt",group:1},
{kind:"view",id:"staff",label:"ทีมและสิทธิ์การใช้งาน",icon:"id",group:3},
{kind:"view",id:"kpi",label:"KPI พนักงาน",icon:"trophy",group:3},
{kind:"view",id:"reviews",label:"รีวิวพนักงาน",icon:"star",group:3},
{kind:"view",id:"tasks_table",label:"งานดูแลย้อนหลัง",icon:"table",group:2},
{kind:"view",id:"facility_tasks",label:"งานส่วนกลางของสาขา",icon:"wrench",group:2},
{kind:"view",id:"master_tasks",label:"แม่แบบงานมาตรฐาน",icon:"book",group:2},
{kind:"view",id:"official-docs",label:"เอกสารและระเบียบ",icon:"files",group:2},
{kind:"view",id:"tutorials",label:"วิดีโอสอนใช้งาน",icon:"play",group:2},
{kind:"view",id:"audit",label:"บันทึกการใช้งานระบบ",icon:"history",group:2},
{kind:"link",href:"/staff",label:"KinApp (แอปพยาบาล)",icon:"phone",group:2,perm:"app.staff"},
{kind:"link",href:"/pharmacy",label:"ห้องยา (จัดยา · คลัง)",icon:"pill",group:2,perm:"app.pharmacy"},
];
/** หน้า "ส่งออกข้อมูล" ไม่มีสิทธิ์ของตัวเอง: เห็นเมนูเมื่อมีสิทธิ์หน้าต้นทางของไฟล์ใดไฟล์หนึ่ง (แต่ละไฟล์ตรวจสิทธิ์ของตัวเองอีกชั้น) */
export const EXPORT_SOURCES: ViewId[] = ["billing", "dashboard", "quotations", "contracts", "appointments", "health_logs", "tasks_table", "roster", "kpi", "staff", "branches", "prices", "facility_tasks", "master_tasks"];
