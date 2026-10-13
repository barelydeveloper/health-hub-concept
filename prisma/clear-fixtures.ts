import { clearFixtures } from "./seed";
import { prisma } from "../src/server/db";

clearFixtures()
  .then(async () => {
    console.log("Removed fixture-origin records. User accounts and non-fixture data were left in place.");
    await prisma.$disconnect();
  })
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
