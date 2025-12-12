import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { JwtService, JwtSignOptions } from "@nestjs/jwt";
import { Share, User } from "@prisma/client";
import * as argon from "argon2";
import * as fs from "fs";
import * as moment from "moment";
import * as path from "path";
import { Worker } from "worker_threads";
import { ClamScanService } from "src/clamscan/clamscan.service";
import { ConfigService } from "src/config/config.service";
import { EmailService } from "src/email/email.service";
import { FileService } from "src/file/file.service";
import { PrismaService } from "src/prisma/prisma.service";
import { ReverseShareService } from "src/reverseShare/reverseShare.service";
import { parseRelativeDateToAbsolute } from "src/utils/date.util";
import { SHARE_DIRECTORY } from "../constants";
import { CreateShareDTO } from "./dto/createShare.dto";
import { UpdateShareDTO } from "./dto/updateShare.dto";

@Injectable()
export class ShareService {
  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
    private fileService: FileService,
    private emailService: EmailService,
    private config: ConfigService,
    private jwtService: JwtService,
    private reverseShareService: ReverseShareService,
    private clamScanService: ClamScanService,
  ) { }

  async create(share: CreateShareDTO, user?: User, reverseShareToken?: string) {
    if (!(await this.isShareIdAvailable(share.id)).isAvailable)
      throw new BadRequestException("Share id already in use");

    if (!share.security || Object.keys(share.security).length == 0)
      share.security = undefined;

    if (share.security?.password) {
      share.security.password = await argon.hash(share.security.password);
    }

    let expirationDate: Date;

    // If share is created by a reverse share token override the expiration date
    const reverseShare =
      await this.reverseShareService.getByToken(reverseShareToken);
    if (reverseShare) {
      expirationDate = reverseShare.shareExpiration;
    } else {
      const parsedExpiration = parseRelativeDateToAbsolute(share.expiration);

      const expiresNever = moment(0).toDate() == parsedExpiration;

      const maxExpiration = this.config.get("share.maxExpiration");
      if (
        maxExpiration.value !== 0 &&
        (expiresNever ||
          parsedExpiration >
          moment().add(maxExpiration.value, maxExpiration.unit).toDate())
      ) {
        throw new BadRequestException(
          "Expiration date exceeds maximum expiration date",
        );
      }

      expirationDate = parsedExpiration;
    }

    fs.mkdirSync(`${SHARE_DIRECTORY}/${share.id}`, {
      recursive: true,
    });

    const shareTuple = await this.prisma.share.create({
      data: {
        ...share,
        expiration: expirationDate,
        creator: { connect: user ? { id: user.id } : undefined },
        security: { create: share.security },
        recipients: {
          create: share.recipients
            ? share.recipients.map((email) => ({ email }))
            : [],
        },
        storageProvider: this.configService.get("s3.enabled") ? "S3" : "LOCAL",
      },
    });

    if (reverseShare) {
      // Assign share to reverse share token
      await this.prisma.reverseShare.update({
        where: { token: reverseShareToken },
        data: {
          shares: {
            connect: { id: shareTuple.id },
          },
        },
      });
    }

    return shareTuple;
  }

  async createZip(shareId: string) {
    if (this.config.get("s3.enabled")) return;

    const files = await this.prisma.file.findMany({ where: { shareId } });

    return new Promise((resolve, reject) => {
      const isTs = __filename.endsWith(".ts");
      const workerFileName = isTs ? "zip.worker.ts" : "zip.worker.js";
      const workerPath = path.join(__dirname, workerFileName);

      const worker = new Worker(workerPath, {
        workerData: {
          shareId,
          files,
          shareDirectory: SHARE_DIRECTORY,
          compressionLevel: this.config.get("share.zipCompressionLevel"),
        },
        execArgv: isTs ? ["-r", "ts-node/register"] : undefined,
      });

      worker.on("message", (message) => {
        if (typeof message === "object" && message.error) {
          reject(new Error(message.error));
        } else {
          resolve(message);
        }
      });
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0)
          reject(new Error(`Worker stopped with exit code ${code}`));
      });
    });
  }

  async complete(id: string, reverseShareToken?: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
      include: {
        files: true,
        recipients: true,
        creator: true,
        reverseShare: { include: { creator: true } },
      },
    });

    if (await this.isShareCompleted(id))
      throw new BadRequestException("Share already completed");

    if (share.files.length == 0)
      throw new BadRequestException(
        "You need at least on file in your share to complete it.",
      );

    // Asynchronously create a zip of all files
    if (share.files.length > 1)
      this.createZip(id).then(() =>
        this.prisma.share.update({ where: { id }, data: { isZipReady: true } }),
      );

    // Send email for each recipient
    for (const recipient of share.recipients) {
      await this.emailService.sendMailToShareRecipients(
        recipient.email,
        share.id,
        share.creator,
        share.description,
        share.expiration,
      );
    }

    const notifyReverseShareCreator = share.reverseShare
      ? this.config.get("smtp.enabled") &&
      share.reverseShare.sendEmailNotification
      : undefined;

    if (notifyReverseShareCreator) {
      await this.emailService.sendMailToReverseShareCreator(
        share.reverseShare.creator.email,
        share.id,
      );
    }

    // Check if any file is malicious with ClamAV
    void this.clamScanService.checkAndRemove(share.id);

    if (share.reverseShare) {
      await this.prisma.reverseShare.update({
        where: { token: reverseShareToken },
        data: { remainingUses: { decrement: 1 } },
      });
    }

    await this.prisma.share.update({
      where: { id },
      data: { uploadLocked: true },
    });

    // Return the original share data (which includes files) with the notification flag
    return {
      ...share,
      notifyReverseShareCreator,
    } as any;
  }

  async revertComplete(id: string) {
    return this.prisma.share.update({
      where: { id },
      data: { uploadLocked: false, isZipReady: false },
    });
  }

  async getShares() {
    const shares = await this.prisma.share.findMany({
      orderBy: {
        expiration: "desc",
      },
      include: { files: true, creator: true },
    });

    return shares.map((share) => {
      return {
        ...share,
        size: share.files.reduce((acc, file) => acc + parseInt(file.size), 0),
      };
    });
  }

  async getSharesByUser(userId: string) {
    const shares = await this.prisma.share.findMany({
      where: {
        creator: { id: userId },
        uploadLocked: true,
        // We want to grab any shares that are not expired or have their expiration date set to "never" (unix 0)
        OR: [
          { expiration: { gt: new Date() } },
          { expiration: { equals: moment(0).toDate() } },
        ],
      },
      orderBy: {
        expiration: "desc",
      },
      include: { recipients: true, files: { select: { size: true } }, security: true },
    });

    return shares.map((share) => {
      return {
        ...share,
        size: share.files.reduce((acc, file) => acc + parseInt(file.size), 0),
        recipients: share.recipients.map((recipients) => recipients.email),
        security: {
          maxViews: share.security?.maxViews,
          passwordProtected: !!share.security?.password,
        },
      };
    });
  }

  async get(id: string): Promise<any> {
    const share = await this.prisma.share.findUnique({
      where: { id },
      include: {
        files: {
          orderBy: {
            name: "asc",
          },
        },
        creator: true,
        security: true,
      },
    });

    if (share.removedReason)
      throw new NotFoundException(share.removedReason, "share_removed");

    if (!share || !share.uploadLocked)
      throw new NotFoundException("Share not found");
    return {
      ...share,
      hasPassword: !!share.security?.password,
    };
  }

  async getMetaData(id: string) {
    const share = await this.prisma.share.findUnique({
      where: { id },
    });

    if (!share || !share.uploadLocked)
      throw new NotFoundException("Share not found");

    return share;
  }

  async update(shareId: string, updateData: UpdateShareDTO) {
    // Check if share exists and user has permission
    const existingShare = await this.prisma.share.findUnique({
      where: { id: shareId },
      include: { security: true },
    });

    if (!existingShare) {
      throw new NotFoundException("Share not found");
    }

    // Prepare update data
    const updateShare: any = {};
    const updateSecurity: any = {};
    let hasSecurityUpdates = false;

    // Update basic fields
    if (updateData.name !== undefined) {
      updateShare.name = updateData.name;
    }

    if (updateData.description !== undefined) {
      updateShare.description = updateData.description;
    }

    // Handle expiration
    if (updateData.expiration !== undefined) {
      if (updateData.expiration === "never") {
        updateShare.expiration = new Date(0);
      } else {
        updateShare.expiration = parseRelativeDateToAbsolute(updateData.expiration);
      }
    }

    // Handle security updates
    if (updateData.security) {
      hasSecurityUpdates = true;

      if (updateData.security.password) {
        updateSecurity.password = await argon.hash(updateData.security.password);
      }

      if (updateData.security.maxViews !== undefined) {
        updateSecurity.maxViews = updateData.security.maxViews;
      }
    }

    // Update the share
    await this.prisma.share.update({
      where: { id: shareId },
      data: {
        ...updateShare,
        ...(hasSecurityUpdates && {
          security: existingShare.security
            ? {
              update: updateSecurity,
            }
            : {
              create: updateSecurity,
            },
        }),
      },
    });

    // Return the updated share using the existing get method which has proper DTO formatting
    return this.get(shareId);
  }

  async remove(shareId: string, isDeleterAdmin = false) {
    const share = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    if (!share) throw new NotFoundException("Share not found");

    if (!share.creatorId && !isDeleterAdmin)
      throw new ForbiddenException("Anonymous shares can't be deleted");

    await this.fileService.deleteAllFiles(shareId);
    await this.prisma.share.delete({ where: { id: shareId } });
  }

  async isShareCompleted(id: string) {
    return (await this.prisma.share.findUnique({ where: { id } })).uploadLocked;
  }

  async isShareIdAvailable(id: string) {
    const share = await this.prisma.share.findUnique({ where: { id } });
    return { isAvailable: !share };
  }

  async increaseViewCount(share: Share) {
    await this.prisma.share.update({
      where: { id: share.id },
      data: { views: share.views + 1 },
    });
  }

  async getShareToken(shareId: string, password: string) {
    const share = await this.prisma.share.findFirst({
      where: { id: shareId },
      include: {
        security: true,
      },
    });

    if (share?.security?.password) {
      if (!password) {
        throw new ForbiddenException(
          "This share is password protected",
          "share_password_required",
        );
      }

      const isPasswordValid = await argon.verify(
        share.security.password,
        password,
      );
      if (!isPasswordValid) {
        throw new ForbiddenException("Wrong password", "wrong_password");
      }
    }

    if (share.security?.maxViews && share.security.maxViews <= share.views) {
      throw new ForbiddenException(
        "Maximum views exceeded",
        "share_max_views_exceeded",
      );
    }

    const token = await this.generateShareToken(shareId);
    await this.increaseViewCount(share);
    return token;
  }

  async generateShareToken(shareId: string) {
    const { expiration, createdAt } = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    const tokenPayload = {
      shareId,
      shareCreatedAt: moment(createdAt).unix(),
      iat: moment().unix(),
    };

    const tokenOptions: JwtSignOptions = {
      secret: this.config.get("internal.jwtSecret"),
    };

    if (!moment(expiration).isSame(0)) {
      tokenOptions.expiresIn = moment(expiration).diff(new Date(), "seconds");
    }

    return this.jwtService.sign(tokenPayload, tokenOptions);
  }

  async verifyShareToken(shareId: string, token: string) {
    const { expiration, createdAt } = await this.prisma.share.findUnique({
      where: { id: shareId },
    });

    try {
      const claims = this.jwtService.verify(token, {
        secret: this.config.get("internal.jwtSecret"),
        // Ignore expiration if expiration is 0
        ignoreExpiration: moment(expiration).isSame(0),
      });

      return (
        claims.shareId == shareId &&
        claims.shareCreatedAt == moment(createdAt).unix()
      );
    } catch {
      return false;
    }
  }
}
