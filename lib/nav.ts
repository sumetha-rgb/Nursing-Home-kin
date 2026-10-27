export type ViewId = "careplan"|"contracts"|"residents"|"tasks_table"|"tasks"|"appointments"|"health_logs"|"feedbacks"|"dashboard"|"official-docs"|"branches"|"staff"|"facility_tasks"|"master_tasks"|"quotations"|"audit";
export type NavItem = {kind:"view";id:ViewId;label:string;icon:string;group:0|1|2}|{kind:"link";href:string;label:string;icon:string;group:0|1|2};
export const NAV:NavItem[]=[
{kind:"view",id:"careplan",label:"ภาพรวมการดูแล",icon:"grid",group:0},
{kind:"view",id:"residents",label:"ผู้รับบริการ",icon:"user",group:0},
{kind:"view",id:"tasks",label:"งานประจำวัน",icon:"check",group:0},
{kind:"view",id:"appointments",label:"ตารางนัดหมาย",icon:"calendar",group:0},
{kind:"view",id:"health_logs",label:"บันทึกสุขภาพ",icon:"heart",group:0},
{kind:"view",id:"quotations",label:"แผนดูแลและใบประเมิน",icon:"flow",group:0},
{kind:"view",id:"contracts",label:"สัญญาบริการ",icon:"doc",group:1},
{kind:"view",id:"dashboard",label:"ผลการดำเนินงาน",icon:"chart",group:1},
{kind:"view",id:"branches",label:"สาขาของเรา",icon:"building",group:1},
{kind:"view",id:"staff",label:"ทีมและสิทธิ์การใช้งาน",icon:"id",group:1},
{kind:"view",id:"feedbacks",label:"เสียงจากครอบครัว",icon:"chat",group:1},
{kind:"view",id:"audit",label:"ประวัติการแก้ไข",icon:"history",group:1},
{kind:"view",id:"tasks_table",label:"ทะเบียนงาน",icon:"table",group:2},
{kind:"view",id:"facility_tasks",label:"งานทั่วไปของศูนย์",icon:"building",group:2},
{kind:"view",id:"master_tasks",label:"คลังงานมาตรฐาน",icon:"book",group:2},
{kind:"view",id:"official-docs",label:"เอกสารและระเบียบ",icon:"files",group:2},
{kind:"link",href:"/staff",label:"แอปทีมดูแล",icon:"phone",group:2},
];
