import "reflect-metadata";
import { createSQLiteServer } from "./../../connect";
import { assertNotNull } from "../../utils";
import { ApolloServer } from "apollo-server";
import { getManager, EntityManager } from "typeorm";
import { Container } from "typedi";
import { ProbeRepository } from "../../repositories/probe_repository";
import {
    NewTraceWithState,
    NewTraceWithStateVariables,
} from "../../generated/NewTraceWithState";
import {
    Probe,
    TraceSet,
    TraceLog,
    FunctionInfo,
    FileInfo,
    Trace,
    Organization,
} from "../../entities";
import {
    createTestClient,
    ApolloServerTestClient,
} from "apollo-server-testing";
import gql from "graphql-tag";
import { DirectoryInfoRepository } from "../../repositories/directory_info_repository";
import {
    createWrappedTestClient,
    TestClientWrapper,
    GQLResponse,
} from "../../utils/testing";
import {
    TraceSetQueryVariables,
    TraceSetQuery,
} from "../../generated/TraceSetQuery";
import { UpdateTrace, UpdateTraceVariables } from "../../generated/UpdateTrace";
import { DeleteTrace, DeleteTraceVariables } from "../../generated/DeleteTrace";
import { NewTraceSet } from "../../generated/NewTraceSet";
import { NewTrace, NewTraceVariables } from "../../generated/NewTrace";

const FIND_TRACE_SET = gql`
    query TraceSetQuery($id: String!) {
        traceSet(traceSetId: $id) {
            id
        }
    }
`;

export const NEW_TRACE_SET = gql`
    mutation NewTraceSet {
        newTraceSet {
            id
        }
    }
`;

const NEW_TRACE = gql`
    mutation NewTrace(
        $functionId: String!
        $statement: String!
        $id: String!
        $line: Int!
    ) {
        newTrace(
            newTraceInput: {
                functionId: $functionId
                statement: $statement
                traceSetId: $id
                line: $line
            }
        ) {
            function {
                name
            }
            statement
            traceSet {
                id
            }
        }
    }
`;

describe("testing server", () => {
    let server: ApolloServer;
    let client: TestClientWrapper;
    let manager: EntityManager;
    let func1: FunctionInfo;
    let func2: FunctionInfo;
    let org: Organization;
    beforeAll(async () => {
        Container.reset();
        server = await createSQLiteServer();
        client = createWrappedTestClient(server);
        manager = getManager();
        const dirRepo = manager.getCustomRepository(DirectoryInfoRepository);
        const rootDirId = (await dirRepo.genRootDir()).id;

        const file = await manager.save(
            FileInfo.create({
                name: "test_file",
                objectName: "test_object",
                parentDirectoryId: rootDirId,
                md5sum: "random sum",
            })
        );

        func1 = await manager.save(
            manager.create(FunctionInfo, {
                name: "func1",
                startLine: 4,
                endLine: 5,
                fileId: file.id,
            })
        );

        func2 = await manager.save(
            manager.create(FunctionInfo, {
                name: "func2",
                startLine: 4,
                endLine: 5,
                fileId: file.id,
            })
        );

        org = await manager.save(Organization.create({ name: "test" }));
    });

    afterAll(async () => {
        await server.stop();
        Container.reset();
    });

    it("should fail to find trace set object", async () => {
        expect(
            await client.query<TraceSetQuery, TraceSetQueryVariables>({
                query: FIND_TRACE_SET,
                variables: {
                    id: "test",
                },
            })
        ).toMatchObject({
            data: { traceSet: null },
            errors: undefined,
        });
    });

    it("should create new trace set object", async () => {
        const res = await client.mutate<NewTraceSet>({
            mutation: NEW_TRACE_SET,
            variables: undefined,
        });
        expect(res).toMatchObject({
            data: {
                newTraceSet: {},
            },
            errors: undefined,
        });

        expect(
            await client.mutate<TraceSetQuery, TraceSetQueryVariables>({
                mutation: FIND_TRACE_SET,
                variables: {
                    id: res.data?.newTraceSet.id || "test",
                },
            })
        ).toMatchObject({
            data: {
                traceSet: {
                    id: res.data?.newTraceSet.id || "test",
                },
            },
            errors: undefined,
        });
    });

    describe("new trace tests", () => {
        it("should create new trace object", async () => {
            const traceSet = await client.mutate<NewTraceSet>({
                mutation: NEW_TRACE_SET,
                variables: undefined,
            });

            const id = traceSet.data?.newTraceSet.id || "test_id";
            expect(traceSet).toMatchObject({ data: { newTraceSet: {} } });

            expect(
                await client.mutate<NewTrace, NewTraceVariables>({
                    mutation: NEW_TRACE,
                    variables: {
                        functionId: func1.id,
                        line: 2,
                        statement: "statement",
                        id,
                    },
                })
            ).toMatchObject({
                data: {
                    newTrace: {
                        function: {
                            name: "func1",
                        },
                        statement: "statement",
                    },
                },
                errors: undefined,
            });
        });

        it("secondary objects should have been created", async () => {
            const traceSet = await manager.save(
                TraceSet.create({
                    organizationId: org.id,
                })
            );

            const probe = await manager.save(
                manager.create(Probe, {
                    traceSetId: traceSet.id,
                    lastHeartbeat: new Date(),
                })
            );

            const probeRepository = manager.getCustomRepository(
                ProbeRepository
            );
            expect(
                await probeRepository.findActiveProbesIds(traceSet.id)
            ).toMatchObject([{}]);

            expect(
                await client.mutate<NewTrace, NewTraceVariables>({
                    mutation: NEW_TRACE,
                    variables: {
                        functionId: func1.id,
                        line: 2,
                        statement: "statement",
                        id: traceSet.id,
                    },
                })
            ).toMatchObject({
                data: {
                    newTrace: {
                        function: {
                            name: "func1",
                        },
                        statement: "statement",
                    },
                },
                errors: undefined,
            });

            expect(
                await probeRepository.findActiveProbesIds(traceSet.id)
            ).toMatchObject([{}]);

            const traceLog = await manager.findOne(TraceLog, {
                relations: ["traceLogStatuses"],
                where: {
                    traceSetId: traceSet.id,
                },
                order: {
                    updatedAt: "DESC",
                },
            });

            expect(traceLog).toBeTruthy();
            if (!traceLog) throw new Error("tracelog should be truthy");

            expect(await traceLog.traceLogStatuses).toMatchObject([
                { probeId: probe.id, type: 0 },
            ]);

            const newProbe = await manager.findOne(Probe, {
                where: {
                    id: probe.id,
                },
                relations: ["traceLogStatuses"],
            });
            expect(newProbe).toBeTruthy();
            if (!newProbe) throw new Error("probe should be truthy");

            expect(newProbe).toMatchObject({
                id: probe.id,
            });

            expect(await newProbe.traceLogStatuses).toMatchObject([{}]);
        });
    });

    describe("desired state tests", () => {
        const NEW_TRACE_WITH_DESIRED_STATE = gql`
            mutation NewTraceWithState(
                $functionId: String!
                $statement: String!
                $id: String!
                $line: Int!
            ) {
                newTrace(
                    newTraceInput: {
                        functionId: $functionId
                        statement: $statement
                        traceSetId: $id
                        line: $line
                    }
                ) {
                    id
                    function {
                        name
                    }
                    statement
                    traceSet {
                        id
                        desiredSet {
                            function {
                                name
                            }
                            statement
                        }
                    }
                }
            }
        `;

        const UPDATE_TRACE_WITH_DESIRED_STATE = gql`
            mutation UpdateTrace(
                $statement: String
                $active: Boolean
                $id: String!
            ) {
                updateTrace(
                    updateTraceInput: {
                        statement: $statement
                        active: $active
                        id: $id
                    }
                ) {
                    id
                    function {
                        name
                    }
                    statement
                    traceSet {
                        id
                        desiredSet {
                            function {
                                name
                            }
                            statement
                        }
                    }
                }
            }
        `;

        const DELETE_TRACE_WITH_DESIRED_STATE = gql`
            mutation DeleteTrace($id: String!) {
                deleteTrace(traceId: $id) {
                    id
                    function {
                        name
                    }
                    statement
                    traceSet {
                        id
                        desiredSet {
                            function {
                                name
                            }
                            statement
                        }
                    }
                }
            }
        `;

        let KEY = "test-id2";
        let modId = "";
        let mod2Id = "";

        it("trace set should have been created", async () => {
            const traceSet = await manager.save(
                TraceSet.create({
                    organizationId: org.id,
                })
            );
            KEY = traceSet.id;
            expect(traceSet).toMatchObject({ id: KEY });
        });

        it("desired set should have one object", async () => {
            const mod1: GQLResponse<NewTraceWithState> = await client.mutate<
                NewTraceWithState,
                NewTraceWithStateVariables
            >({
                mutation: NEW_TRACE_WITH_DESIRED_STATE,
                variables: {
                    functionId: func1.id,
                    line: 2,
                    statement: "statement",
                    id: KEY,
                },
            });
            if (!mod1.data) throw new Error(`${mod1.errors}`);
            modId = mod1.data.newTrace.id;
            expect(mod1).toMatchObject({
                data: {
                    newTrace: {
                        function: {
                            name: "func1",
                        },
                        statement: "statement",
                        traceSet: {
                            id: KEY,
                            desiredSet: [
                                {
                                    function: {
                                        name: "func1",
                                    },
                                    statement: "statement",
                                },
                            ],
                        },
                    },
                },
                errors: undefined,
            });
        });

        it("desired set should have two object", async () => {
            const mod2 = await client.mutate<
                NewTraceWithState,
                NewTraceWithStateVariables
            >({
                mutation: NEW_TRACE_WITH_DESIRED_STATE,
                variables: {
                    functionId: func2.id,
                    line: 2,
                    statement: "statement",
                    id: KEY,
                },
            });
            if (!mod2.data) throw new Error(`${mod2.errors}`);
            mod2Id = mod2.data.newTrace.id;
            expect(mod2).toMatchObject({
                data: {
                    newTrace: {
                        function: {
                            name: "func2",
                        },
                        statement: "statement",
                        traceSet: {
                            id: KEY,
                            desiredSet: [{}, {}],
                        },
                    },
                },
                errors: undefined,
            });
        });

        it("desired set should come out in reverse updated order", async () => {
            const traces = await manager.find(Trace, {
                where: {
                    traceSetId: assertNotNull(
                        await manager.findOne(TraceSet, { id: KEY })
                    ).id,
                    active: true,
                },
                order: {
                    updatedAt: "DESC",
                },
            });

            expect(traces).toMatchObject([{}, {}]);

            expect(traces[1].updatedAt.valueOf()).toBeLessThanOrEqual(
                traces[0].updatedAt.valueOf()
            );
        });

        it("desired set should lose one object", async () => {
            expect(
                await client.mutate<UpdateTrace, UpdateTraceVariables>({
                    mutation: UPDATE_TRACE_WITH_DESIRED_STATE,
                    variables: {
                        active: false,
                        id: mod2Id,
                    },
                })
            ).toMatchObject({
                data: {
                    updateTrace: {
                        function: {
                            name: "func2",
                        },
                        statement: "statement",
                        traceSet: {
                            id: KEY,
                            desiredSet: [
                                {
                                    function: {
                                        name: "func1",
                                    },
                                    statement: "statement",
                                },
                            ],
                        },
                    },
                },
                errors: undefined,
            });
        });

        it("desired set should have statements change", async () => {
            expect(
                await client.mutate<UpdateTrace, UpdateTraceVariables>({
                    mutation: UPDATE_TRACE_WITH_DESIRED_STATE,
                    variables: {
                        statement: "statements",
                        id: modId,
                    },
                })
            ).toMatchObject({
                data: {
                    updateTrace: {
                        function: {
                            name: "func1",
                        },
                        statement: "statements",
                        traceSet: {
                            id: KEY,
                            desiredSet: [
                                {
                                    function: {
                                        name: "func1",
                                    },
                                    statement: "statements",
                                },
                            ],
                        },
                    },
                },
                errors: undefined,
            });
        });

        it("desired set should have gain mod2 again", async () => {
            expect(
                await client.mutate<UpdateTrace, UpdateTraceVariables>({
                    mutation: UPDATE_TRACE_WITH_DESIRED_STATE,
                    variables: {
                        active: true,
                        id: mod2Id,
                    },
                })
            ).toMatchObject({
                data: {
                    updateTrace: {
                        function: {
                            name: "func2",
                        },
                        statement: "statement",
                        traceSet: {
                            id: KEY,
                            desiredSet: [{}, {}],
                        },
                    },
                },
                errors: undefined,
            });
        });

        it("delete trace should lose mod2 now permanently", async () => {
            expect(
                await client.mutate<DeleteTrace, DeleteTraceVariables>({
                    mutation: DELETE_TRACE_WITH_DESIRED_STATE,
                    variables: {
                        id: mod2Id,
                    },
                })
            ).toMatchObject({
                data: {
                    deleteTrace: {
                        function: {
                            name: "func2",
                        },
                        statement: "statement",
                        traceSet: {
                            id: KEY,
                            desiredSet: [{}],
                        },
                    },
                },
                errors: undefined,
            });
        });

        it("connecting to that trace should now fail", async () => {
            expect(
                await client.mutate<DeleteTrace, DeleteTraceVariables>({
                    mutation: DELETE_TRACE_WITH_DESIRED_STATE,
                    variables: {
                        id: mod2Id,
                    },
                })
            ).toMatchObject({
                data: null,
                errors: [{}],
            });

            expect(
                await client.mutate<UpdateTrace, UpdateTraceVariables>({
                    mutation: UPDATE_TRACE_WITH_DESIRED_STATE,
                    variables: {
                        statement: "func",
                        id: mod2Id,
                    },
                })
            ).toMatchObject({
                data: null,
                errors: [{}],
            });
        });
    });
});
