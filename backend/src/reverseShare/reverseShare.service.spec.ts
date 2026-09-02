import { strict as assert } from "node:assert";
import { test } from "node:test";
import { ReverseShareService } from "./reverseShare.service";

test("create uses the server-wide maximum share size", async () => {
  let persistedData: Record<string, unknown> | undefined;
  const config = {
    get: (key: string) => {
      if (key === "share.maxExpiration") return { value: 0, unit: "days" };
      if (key === "share.maxSize") return 5_000_000_000;
      throw new Error(`Unexpected config key: ${key}`);
    },
  };
  const prisma = {
    reverseShare: {
      create: async ({ data }: { data: Record<string, unknown> }) => {
        persistedData = data;
        return { token: "reverse-share-token" };
      },
    },
  };
  const service = new ReverseShareService(
    config as never,
    prisma as never,
    {} as never,
  );

  const token = await service.create(
    {
      shareExpiration: "1-days",
      maxShareSize: "100",
      maxUseCount: 1,
      sendEmailNotification: false,
      simplified: false,
      publicAccess: true,
    } as Parameters<ReverseShareService["create"]>[0] & {
      maxShareSize: string;
    },
    "creator-id",
  );

  assert.equal(token, "reverse-share-token");
  assert.equal(persistedData?.maxShareSize, "5000000000");
});

test("getAllByUser returns the accumulated size of every uploaded file", async () => {
  const reverseShares = [
    {
      id: "reverse-share-id",
      shares: [
        { files: [{ size: "1024" }, { size: "2048" }] },
        { files: [{ size: "4096" }] },
      ],
    },
  ];
  const prisma = {
    reverseShare: {
      findMany: async () => reverseShares,
    },
  };
  const service = new ReverseShareService(
    {} as never,
    prisma as never,
    {} as never,
  );

  const result = await service.getAllByUser("creator-id");

  assert.equal((result[0] as { uploadedSize?: number }).uploadedSize, 7168);
});
