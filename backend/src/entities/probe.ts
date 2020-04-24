import { Field, ObjectType } from "type-graphql";
import { GraphQLBoolean } from "graphql";
import {
    Entity,
    PrimaryGeneratedColumn,
    Generated,
    Column,
    Index,
    OneToMany,
    ManyToOne,
} from "typeorm";

import { TraceSet } from "./trace/trace_set";
import { TraceLogStatus } from "./trace/trace_log_status";
import { TraceFailure } from "./trace/trace_failure";

/**
 * Probe
 *
 * quick lookup:
 *  - numeric id
 *
 * a running instance of an inquest probe
 * TODO probes should be connected to users
 * TODO probes should list which files are currently being logged
 */
@Entity()
@ObjectType()
export class Probe {
    @PrimaryGeneratedColumn()
    readonly id: number;

    @Field({ nullable: false })
    @Column({ nullable: false })
    lastHeartbeat: Date;

    @Field()
    @Index({ unique: true })
    @Column({ nullable: false, unique: true })
    @Generated("uuid")
    key: string;

    @Field((type) => GraphQLBoolean, { nullable: false })
    isAlive(): boolean {
        // TODO make this smarter
        const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
        return twoMinutesAgo >= this.lastHeartbeat;
    }

    @Field((type) => [TraceLogStatus], { nullable: false })
    @OneToMany(
        (type) => TraceLogStatus,
        (traceLogStatus) => traceLogStatus.probe
    )
    traceLogStatuses: Promise<TraceLogStatus[]>;

    @Field((type) => [TraceFailure], { nullable: false })
    @OneToMany((type) => TraceFailure, (traceFailure) => traceFailure.probe)
    traceFailures: Promise<TraceFailure[]>;

    /**
     * the respective TraceSet
     */
    @Field((type) => TraceSet, { nullable: false })
    @ManyToOne((type) => TraceSet, { nullable: false })
    traceSet: Promise<TraceSet>;

    @Index()
    @Column({ nullable: false })
    traceSetId: number;
}
