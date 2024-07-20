import { Duration, Stack, StackProps } from 'aws-cdk-lib';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as route53Targets from 'aws-cdk-lib/aws-route53-targets';
import { Construct } from 'constructs';

export type LoadBalancerProps = {
  vpc: ec2.IVpc;
  allowedCidrs: string[];
  hostName: string;
  domainName: string;
  hostedZoneId: string;
} & StackProps;

export class LoadBalancer extends Construct implements ec2.IConnectable {
  private lb: elb.IApplicationLoadBalancer;
  private domainName: string;
  private hostedZoneId: string;
  public url: string;
  connections: ec2.Connections;

  constructor(scope: Construct, id: string, props: LoadBalancerProps) {
    super(scope, id);

    this.domainName = props.domainName;
    this.hostedZoneId = props.hostedZoneId;

    const sg = new ec2.SecurityGroup(this, 'SecurityGroup', {
      vpc: props.vpc,
    });
    const alb = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', {
      vpc: props.vpc,
      securityGroup: sg,
      internetFacing: true,
    });
    const hostedZone = route53.HostedZone.fromHostedZoneAttributes(this, 'HostedZone', {
      hostedZoneId: this.hostedZoneId,
      zoneName: this.domainName,
    });
    const host = `${props.hostName}.${this.domainName}`;
    const certificate = new acm.Certificate(this, 'Certificate', {
      domainName: host,
      validation: acm.CertificateValidation.fromDns(hostedZone),
    });
    alb.addListener('Listener', {
      port: 443,
      open: true,
      certificates: [certificate],
    });
    new route53.ARecord(this, 'ARecord', {
      zone: hostedZone,
      target: route53.RecordTarget.fromAlias(new route53Targets.LoadBalancerTarget(alb)),
      recordName: props.hostName,
    });

    this.url = `https://${host}`;
    this.connections = sg.connections;
    this.lb = alb;
  }

  public addTarget(
    ecsService: ecs.BaseService,
    port: number,
    paths: string[],
    priority: number,
    healthCheckPath?: string,
  ) {
    const listener = this.lb.listeners[0];

    const tg = listener.addTargets(`AlbTarget-priority-${priority}`, {
      port: port,
      targets: [ecsService],
      protocol: elb.ApplicationProtocol.HTTP,
      healthCheck: {
        enabled: true,
        interval: Duration.seconds(30),
        timeout: Duration.seconds(10),
        unhealthyThresholdCount: 6,
        path: healthCheckPath || '/',
        healthyHttpCodes: '200-399',
      },
    });
    listener.addAction(`Action-priority-${priority}`, {
      priority,
      conditions: [elb.ListenerCondition.pathPatterns(paths)],
      action: elb.ListenerAction.forward([tg]),
    });
  }
}
