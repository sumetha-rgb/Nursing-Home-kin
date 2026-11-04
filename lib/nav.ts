export type ViewId = "careplan"|"contracts"|"residents"|"tasks_table"|"tasks"|"appointments"|"health_logs"|"feedbacks"|"dashboard"|"official-docs"|"branches"|"staff"|"facility_tasks"|"master_tasks"|"quotations"|"audit"|"roster"|"reviews"|"kpi"|"tutorials"|"rooms"|"billing";
/** กลุ่มเมนู: 4 บริหาร · 0 พื้นที่ดูแล · 1 สัญญาและการเงิน · 3 ทีมงาน · 2 เครื่องมือและระบบ (ลำดับที่แสดงอยู่ที่ GROUPS ใน Shell.tsx) */
export type NavGroup = 0|1|2|3|4;
export type NavItem = {kind:"view";id:ViewId;label:string;icon:string;group:NavGroup}|{kind:"link";href:string;label:string;icon:string;group:NavGroup;perm:"app.staff"|"app.pharmacy"};
export const NAV:NavItem[]=[
{kind:"view",id:"careplan",label:"หน้าแรก",icon:"grid",group:0},
{kind:"view",id:"residents",label:"ผู้รับบริการ",icon:"user",group:0},
{kind:"view",id:"rooms",label:"ห้องพักและเตียง",icon:"bed",group:0},
{kind:"view",id:"tasks",label:"มอบหมายและตรวจงาน",icon:"check",group:0},
{kind:"view",id:"roster",label:"ตารางเวร",icon:"clock",group:0},
{kind:"view",id:"appointments",label:"ตารางนัดหมาย",icon:"calendar",group:0},
{kind:"view",id:"health_logs",label:"รายงานสุขภาพ",icon:"heart",group:0},
{kind:"view",id:"quotations",label:"ใบเสนอราคา / แผนดูแล",icon:"flow",group:0},
{kind:"view",id:"contracts",label:"สัญญาบริการ",icon:"doc",group:1},
{kind:"view",id:"billing",label:"การเงิน",icon:"receipt",group:1},
{kind:"view",id:"dashboard",label:"ภาพรวมและรายงาน",icon:"chart",group:4},
{kind:"view",id:"branches",label:"สาขาของเรา",icon:"building",group:4},
{kind:"view",id:"staff",label:"ทีมและสิทธิ์การใช้งาน",icon:"id",group:3},
{kind:"view",id:"kpi",label:"KPI พนักงาน",icon:"trophy",group:3},
{kind:"view",id:"reviews",label:"รีวิวพนักงาน",icon:"star",group:3},
{kind:"view",id:"feedbacks",label:"เสียงจากครอบครัว",icon:"chat",group:3},
{kind:"view",id:"audit",label:"ประวัติการใช้งาน",icon:"history",group:3},
{kind:"view",id:"tasks_table",label:"ประวัติงานดูแล",icon:"table",group:2},
{kind:"view",id:"facility_tasks",label:"งานส่วนกลางของสาขา",icon:"wrench",group:2},
{kind:"view",id:"master_tasks",label:"แม่แบบงานมาตรฐาน",icon:"book",group:2},
{kind:"view",id:"official-docs",label:"เอกสารและระเบียบ",icon:"files",group:2},
{kind:"view",id:"tutorials",label:"วิดีโอสอนใช้งาน",icon:"play",group:2},
{kind:"link",href:"/staff",label:"KinApp (แอปพยาบาล)",icon:"phone",group:2,perm:"app.staff"},
{kind:"link",href:"/pharmacy",label:"ห้องยา (จัดยา · คลัง)",icon:"pill",group:2,perm:"app.pharmacy"},
];
