import config from "config";
import secret from "../config/secrets.json";
import { ChurchSuiteProvider } from "../api/userProvider/churchSuiteProvider";

async function main() {
  const provider = new ChurchSuiteProvider(
    config.get("churchsuite"),
    secret.churchsuite,
  );

  console.log("Fetching upcoming services...");
  const services = await provider.listServices();
  console.log(`Found ${services.length} service(s)`);
  if (services.length > 0) {
    console.log("Next:", services[0].label);
    const members = await provider.getRotaMembers(services[0]);
    console.log(`Rota members: ${members.length}`);
    for (const member of members.slice(0, 10)) {
      console.log(`  - ${member.name} (${member.role})`);
    }
    if (members.length > 10) {
      console.log(`  ... and ${members.length - 10} more`);
    }
  }
}

main().catch((error) => {
  console.error("ChurchSuite test failed:", error.message);
  process.exit(1);
});
