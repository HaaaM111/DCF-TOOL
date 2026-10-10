const { PrismaClient } = require("./src/generated/prisma");
const p = new PrismaClient();
const mode = process.argv[2];
const spId = "cmv1u62320000o87sni96g7z1";
(async () => {
  if (mode === "create") {
    const code = "TEST-" + Date.now();
    const x = await p.announcement.create({ data: { companyId: spId, source: "cninfo", code, title: "冒烟测试-待删除", publishAt: new Date(), category: "其他", pdfUrl: "", rawText: "test" } });
    console.log(x.id);
  } else if (mode === "count") {
    const id = process.argv[3];
    const n = await p.announcement.count({ where: { id } });
    console.log(n);
  }
  await p.$disconnect();
})().catch((e) => { console.error("ERR", e.message); process.exit(1); });