import { Resolver, Query, Mutation, InputType, Arg, Field } from "type-graphql";
import { EntityManager } from "typeorm";
import { Inject } from "typedi";
import { InjectManager } from "typeorm-typedi-extensions";

import { FileInfo, FunctionInfo, DirectoryInfo, ClassInfo } from "../entities";
import { UploadService } from "../services/upload";
import { PublicError, createTransaction } from "../utils";
import { DirectoryInfoRepository } from "../repositories/directory_info_repository";
import { GraphQLInt } from "graphql";

@InputType({ isAbstract: true })
abstract class NodeInput {
    @Field({ nullable: false })
    name: string;
}

@InputType({ isAbstract: true })
abstract class NodeInputWithLines extends NodeInput {
    @Field((type) => GraphQLInt, { nullable: false })
    startLine: number;

    @Field((type) => GraphQLInt, { nullable: false })
    endLine: number;
}

@InputType()
export class FunctionInput extends NodeInputWithLines {
    @Field({ nullable: true })
    metadata?: string;
}

@InputType()
export class ClassInput extends NodeInputWithLines {
    @Field((type) => [FunctionInput], { nullable: false })
    methods: FunctionInput[];

    @Field((type) => [ClassInput], { nullable: false })
    classes: ClassInput[];
}

@InputType() // introduces a bug with module names being unique
export class FileContentInput {
    @Field((type) => [FunctionInput], { nullable: false })
    functions: FunctionInput[];
    @Field((type) => [ClassInput], { nullable: false })
    classes: ClassInput[];
    @Field({ nullable: false })
    fileId: string;
}

@Resolver()
export class CodeResolver {
    private readonly directoryInfoRepository: DirectoryInfoRepository;
    constructor(
        @InjectManager()
        private readonly manager: EntityManager,
        @Inject((type) => UploadService)
        private readonly uploadService: UploadService
    ) {
        this.directoryInfoRepository = manager.getCustomRepository(
            DirectoryInfoRepository
        );
    }

    @Query((type) => DirectoryInfo, { nullable: true })
    async directory(
        @Arg("directoryId") directoryId: string
    ): Promise<DirectoryInfo | undefined> {
        return await this.directoryInfoRepository.findOne(directoryId);
    }

    /**
     * saveClasses recursively saves the class input and the input's children
     * TODO make this more efficient by saving more in parallel
     */
    private async saveClasses(
        manager: EntityManager,
        classes: ClassInput[],
        fileId: string,
        parentClassId: string | undefined = undefined
    ) {
        const classObjects = await manager.save(
            classes.map((cls) =>
                manager.create(ClassInfo, {
                    name: cls.name,
                    startLine: cls.startLine,
                    endLine: cls.endLine,
                    fileId,
                    parentClassId: parentClassId,
                })
            )
        );

        await manager.save(
            classObjects.flatMap((cls, idx) =>
                classes[idx].methods.map((func) =>
                    manager.create(FunctionInfo, {
                        name: func.name,
                        startLine: func.startLine,
                        endLine: func.endLine,
                        fileId,
                        parentClassId: cls.id,
                    })
                )
            )
        );

        await Promise.all(
            classObjects.map((cls, idx) =>
                this.saveClasses(manager, classes[idx].classes, fileId, cls.id)
            )
        );
        return classObjects;
    }

    @Mutation((type) => FileInfo, { nullable: false })
    async newFileContent(@Arg("fileInput") fileInput: FileContentInput) {
        return await createTransaction(this.manager, async (manager) => {
            const file = await manager.findOne(FileInfo, fileInput.fileId);
            if (file == null || file.id !== fileInput.fileId)
                throw new PublicError("file not found");
            await Promise.all([
                this.saveClasses(manager, fileInput.classes, file.id),
                manager.save(
                    fileInput.functions.map((func) =>
                        manager.create(FunctionInfo, {
                            name: func.name,
                            startLine: func.startLine,
                            endLine: func.endLine,
                            fileId: file.id,
                        })
                    )
                ),
            ]);
            return file;
        });
    }
}
